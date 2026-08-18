import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialStore, OAuthCredential } from '@earendil-works/pi-ai'
import {
  allocateOpenAICodexSessionProfile,
  openAICodexQuotaBucket,
} from '../src/account-allocation.ts'
import { OpenAICodexCredentialStore, OPENAI_CODEX_PROVIDER } from '../src/store.ts'
import type { OpenAICodexUsage } from '../src/usage.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function credential(accountId: string): OAuthCredential {
  return {
    type: 'oauth',
    access: `access-${accountId}`,
    refresh: `refresh-${accountId}`,
    expires: Date.now() + 60_000,
    accountId,
  }
}

function usage(
  codexRemaining: number | undefined,
  sparkRemaining?: number,
  individualRemaining = 100,
): OpenAICodexUsage {
  return {
    rateLimits: [
      ...(codexRemaining === undefined ? [] : [{
        id: 'codex',
        windows: [{ remainingPercent: codexRemaining, windowSeconds: 604_800 }],
      }]),
      ...(sparkRemaining === undefined ? [] : [{
        id: 'codex_spark',
        windows: [{ remainingPercent: sparkRemaining, windowSeconds: 604_800 }],
      }]),
    ],
    individualLimit: {
      limit: '100',
      used: String(100 - individualRemaining),
      remaining: String(individualRemaining),
      remainingPercent: individualRemaining,
    },
  }
}

async function setup(): Promise<{
  store: OpenAICodexCredentialStore
  firstId: string
  secondId: string
}> {
  root = await mkdtemp(join(tmpdir(), 'dsh-openai-codex-allocation-'))
  const store = new OpenAICodexCredentialStore(join(root, 'auth.json'))
  const first = await store.addProfile('First', credential('account-1'))
  const second = await store.addProfile('Second', credential('account-2'))
  return { store, firstId: first.id, secondId: second.id }
}

async function accountId(store: CredentialStore): Promise<string> {
  const value = await store.read(OPENAI_CODEX_PROVIDER)
  if (value?.type !== 'oauth' || typeof value.accountId !== 'string') throw new Error('expected OAuth account')
  return value.accountId
}

describe('OpenAI Codex account allocation', () => {
  it('uses the first profile and stops reading lower-priority quota when it is available', async () => {
    const { store, firstId } = await setup()
    const readUsage = vi.fn(async (_profile: CredentialStore) => usage(25))

    await allocateOpenAICodexSessionProfile(store, 'session-1', 'gpt-5.6-sol', undefined, readUsage)

    expect(await store.sessionProfileId('session-1')).toBe(firstId)
    expect(readUsage).toHaveBeenCalledOnce()
    expect(await accountId(readUsage.mock.calls[0]![0])).toBe('account-1')
  })

  it('uses the next profile when a relevant Codex quota window is exhausted', async () => {
    const { store, secondId } = await setup()
    const visited: string[] = []
    const readUsage = vi.fn(async (profile: CredentialStore) => {
      const account = await accountId(profile)
      visited.push(account)
      return usage(account === 'account-1' ? 0 : 50)
    })

    await allocateOpenAICodexSessionProfile(store, 'session-1', 'gpt-5.6-sol', undefined, readUsage)

    expect(await store.sessionProfileId('session-1')).toBe(secondId)
    expect(visited).toEqual(['account-1', 'account-2'])
  })

  it('uses the Spark bucket only for the Spark model', async () => {
    const { store, firstId, secondId } = await setup()
    const readUsage = vi.fn(async (profile: CredentialStore) => (
      usage(await accountId(profile) === 'account-1' ? 0 : 100, 100)
    ))

    await allocateOpenAICodexSessionProfile(store, 'spark-session', 'gpt-5.3-codex-spark', undefined, readUsage)
    await allocateOpenAICodexSessionProfile(store, 'codex-session', 'gpt-5.6-sol', undefined, readUsage)

    expect(openAICodexQuotaBucket('gpt-5.3-codex-spark')).toBe('codex_spark')
    expect(openAICodexQuotaBucket('gpt-5.6-sol')).toBe('codex')
    expect(await store.sessionProfileId('spark-session')).toBe(firstId)
    expect(await store.sessionProfileId('codex-session')).toBe(secondId)
  })

  it('moves past a profile whose workspace member limit is exhausted', async () => {
    const { store, secondId } = await setup()
    const readUsage = vi.fn(async (profile: CredentialStore) => (
      usage(50, undefined, await accountId(profile) === 'account-1' ? 0 : 80)
    ))

    await allocateOpenAICodexSessionProfile(store, 'session-1', 'gpt-5.6-sol', undefined, readUsage)

    expect(await store.sessionProfileId('session-1')).toBe(secondId)
  })

  it('keeps the first profile eligible when its quota metadata is absent or unreadable', async () => {
    const absent = await setup()
    const absentRead = vi.fn(async () => usage(undefined))
    await allocateOpenAICodexSessionProfile(absent.store, 'absent', 'gpt-5.6-sol', undefined, absentRead)
    expect(await absent.store.sessionProfileId('absent')).toBe(absent.firstId)
    expect(absentRead).toHaveBeenCalledOnce()

    await rm(root as string, { recursive: true, force: true })
    root = undefined
    const unreadable = await setup()
    const unreadableRead = vi.fn(async (): Promise<OpenAICodexUsage> => {
      throw new Error('quota unavailable')
    })
    await allocateOpenAICodexSessionProfile(unreadable.store, 'unreadable', 'gpt-5.6-sol', undefined, unreadableRead)
    expect(await unreadable.store.sessionProfileId('unreadable')).toBe(unreadable.firstId)
    expect(unreadableRead).toHaveBeenCalledOnce()
  })

  it('falls back to the first profile when every account is proven exhausted', async () => {
    const { store, firstId } = await setup()

    await allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      () => Promise.resolve(usage(0)),
    )

    expect(await store.sessionProfileId('session-1')).toBe(firstId)
  })

  it('applies the global priority to an existing Session on its next request', async () => {
    const { store, firstId, secondId } = await setup()
    await store.bindSessionProfile('session-1', secondId)
    const onProfileSwitch = vi.fn()
    const visited: string[] = []
    const readUsage = vi.fn(async (profile: CredentialStore) => {
      visited.push(await accountId(profile))
      return usage(100)
    })

    await allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      readUsage,
      onProfileSwitch,
    )

    expect(await store.sessionProfileId('session-1')).toBe(firstId)
    expect(visited).toEqual(['account-1'])
    expect(onProfileSwitch).toHaveBeenCalledWith('session-1', secondId, firstId)
  })

  it('switches an existing Session to the next profile after explicit exhaustion', async () => {
    const { store, firstId, secondId } = await setup()
    await store.bindSessionProfile('session-1', firstId)
    const onProfileSwitch = vi.fn()
    const visited: string[] = []
    const readUsage = vi.fn(async (profile: CredentialStore) => {
      const account = await accountId(profile)
      visited.push(account)
      return usage(account === 'account-1' ? 0 : 60)
    })

    await allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      readUsage,
      onProfileSwitch,
    )

    expect(await store.sessionProfileId('session-1')).toBe(secondId)
    expect(visited).toEqual(['account-1', 'account-2'])
    expect(onProfileSwitch).toHaveBeenCalledOnce()
    expect(onProfileSwitch).toHaveBeenCalledWith('session-1', firstId, secondId)
  })

  it('uses a newly confirmed global priority for the next request', async () => {
    const { store, firstId, secondId } = await setup()
    await store.bindSessionProfile('session-1', firstId)
    await store.prioritizeProfile(secondId)
    const visited: string[] = []
    const readUsage = vi.fn(async (profile: CredentialStore) => {
      visited.push(await accountId(profile))
      return usage(40)
    })

    await allocateOpenAICodexSessionProfile(store, 'session-1', 'gpt-5.6-sol', undefined, readUsage)

    expect(await store.sessionProfileId('session-1')).toBe(secondId)
    expect(visited).toEqual(['account-2'])
  })

  it('keeps the highest-priority profile eligible when its quota cannot be read', async () => {
    const { store, firstId, secondId } = await setup()
    await store.bindSessionProfile('session-1', secondId)
    const readUsage = vi.fn(async (): Promise<OpenAICodexUsage> => {
      throw new Error('quota unavailable')
    })

    await allocateOpenAICodexSessionProfile(store, 'session-1', 'gpt-5.6-sol', undefined, readUsage)

    expect(await store.sessionProfileId('session-1')).toBe(firstId)
    expect(readUsage).toHaveBeenCalledOnce()
  })

  it('keeps an existing binding when every profile is proven exhausted', async () => {
    const { store, secondId } = await setup()
    await store.bindSessionProfile('session-1', secondId)

    await allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      () => Promise.resolve(usage(0)),
    )

    expect(await store.sessionProfileId('session-1')).toBe(secondId)
  })

  it('keeps the first binding committed by concurrent allocation attempts', async () => {
    const { store, firstId } = await setup()
    let releaseFirstRead: (() => void) | undefined
    let reportFirstReadStarted: (() => void) | undefined
    const firstReadStarted = new Promise<void>((resolve) => {
      reportFirstReadStarted = resolve
    })
    const firstReadReleased = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    let calls = 0
    const readUsage = vi.fn(async () => {
      calls += 1
      if (calls === 1) {
        reportFirstReadStarted?.()
        await firstReadReleased
        return usage(0)
      }
      return usage(100)
    })

    const delayed = allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      readUsage,
    )
    await firstReadStarted
    const committed = await allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      readUsage,
    )
    releaseFirstRead?.()

    expect(committed).toBe(firstId)
    await expect(delayed).resolves.toBe(firstId)
    expect(await store.sessionProfileId('session-1')).toBe(firstId)
  })

  it('does not let a stale exhaustion scan replace a concurrent failover winner', async () => {
    const { store, firstId } = await setup()
    const third = await store.addProfile('Third', credential('account-3'))
    await store.bindSessionProfile('session-1', firstId)
    let releaseDelayedRead: (() => void) | undefined
    let reportDelayedRead: (() => void) | undefined
    const delayedReadStarted = new Promise<void>((resolve) => {
      reportDelayedRead = resolve
    })
    const delayedReadReleased = new Promise<void>((resolve) => {
      releaseDelayedRead = resolve
    })
    let secondAccountReads = 0
    const onProfileSwitch = vi.fn()
    const readUsage = vi.fn(async (profile: CredentialStore) => {
      const account = await accountId(profile)
      if (account === 'account-1') return usage(0)
      if (account === 'account-2') {
        secondAccountReads += 1
        if (secondAccountReads === 1) {
          reportDelayedRead?.()
          await delayedReadReleased
          return usage(80)
        }
        return usage(0)
      }
      return usage(80)
    })

    const delayed = allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      readUsage,
      onProfileSwitch,
    )
    await delayedReadStarted
    const winner = await allocateOpenAICodexSessionProfile(
      store,
      'session-1',
      'gpt-5.6-sol',
      undefined,
      readUsage,
      onProfileSwitch,
    )
    releaseDelayedRead?.()

    expect(winner).toBe(third.id)
    await expect(delayed).resolves.toBe(third.id)
    expect(await store.sessionProfileId('session-1')).toBe(third.id)
    expect(onProfileSwitch).toHaveBeenCalledOnce()
    expect(onProfileSwitch).toHaveBeenCalledWith('session-1', firstId, third.id)
  })
})
