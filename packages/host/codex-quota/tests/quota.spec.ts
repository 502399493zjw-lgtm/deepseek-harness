import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assembleCodexQuotaSnapshot,
  resolveCodexAccountHomes,
} from '../src/index.ts'
import {
  openAICodexAccountName,
  readOpenAICodexAccountName,
} from '../src/account-name.ts'

const savedPool = process.env.DSH_CODEX_ACCOUNT_HOMES
const savedHome = process.env.CODEX_HOME

afterEach(() => {
  if (savedPool === undefined) delete process.env.DSH_CODEX_ACCOUNT_HOMES
  else process.env.DSH_CODEX_ACCOUNT_HOMES = savedPool
  if (savedHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = savedHome
})

describe('Codex quota account pool', () => {
  it('uses configured homes in order and removes duplicates', () => {
    expect(resolveCodexAccountHomes(['./a', './a', './b'])).toEqual([
      resolve('./a'),
      resolve('./b'),
    ])
  })

  it('accepts a platform-delimited pool environment', () => {
    process.env.DSH_CODEX_ACCOUNT_HOMES = ['./one', './two'].join(delimiter)
    expect(resolveCodexAccountHomes(undefined)).toEqual([resolve('./one'), resolve('./two')])
  })

  it('keeps configured pool count while averaging successful reads', async () => {
    const snapshot = await assembleCodexQuotaSnapshot(
      ['current', 'offline', 'other'],
      async (home) => {
        if (home === 'offline') throw new Error('offline')
        return home === 'current'
          ? { accountName: 'current@example.com', remainingPercent: 80, resetsAt: 5_000 }
          : { accountName: 'other@example.com', remainingPercent: 20, resetsAt: 8_000 }
      },
      () => 42,
    )
    expect(snapshot).toEqual({
      currentAccountName: 'current@example.com',
      currentRemainingPercent: 80,
      currentResetsAt: 5_000,
      poolAccountCount: 3,
      poolRemainingPercent: 50,
      refreshedAt: 42,
    })
  })

  it('does not promote another account when the active account is unavailable', async () => {
    const snapshot = await assembleCodexQuotaSnapshot(
      ['current', 'other'],
      async (home) => {
        if (home === 'current') throw new Error('offline')
        return { accountName: 'other@example.com', remainingPercent: 65, resetsAt: null }
      },
      () => 100,
    )
    expect(snapshot).toMatchObject({
      currentAccountName: null,
      currentRemainingPercent: null,
      currentResetsAt: null,
      poolAccountCount: 2,
      poolRemainingPercent: 65,
    })
  })
})

describe('Codex account display name', () => {
  function token(profile: Record<string, unknown>): string {
    const payload = Buffer.from(JSON.stringify({
      'https://api.openai.com/profile': profile,
    })).toString('base64url')
    return `header.${payload}.signature`
  }

  it('uses the same name-then-email display precedence as Settings', () => {
    expect(openAICodexAccountName(token({
      name: '  Codex   User  ',
      email: 'codex@example.com',
    }))).toBe('Codex User')
    expect(openAICodexAccountName(token({ name: ' ', email: 'codex@example.com' })))
      .toBe('codex@example.com')
  })

  it('does not surface malformed or missing credential data', () => {
    expect(openAICodexAccountName(undefined)).toBeUndefined()
    expect(openAICodexAccountName('not-a-token')).toBeUndefined()
    expect(openAICodexAccountName('a.invalid-json.c')).toBeUndefined()
    expect(openAICodexAccountName(`a.${Buffer.from('null').toString('base64url')}.c`))
      .toBeUndefined()
    expect(openAICodexAccountName(`a.${Buffer.from(JSON.stringify({
      'https://api.openai.com/profile': null,
    })).toString('base64url')}.c`)).toBeUndefined()
    expect(openAICodexAccountName(token({ name: '' }))).toBeUndefined()
  })

  it('reads only the display claim from the local Codex auth document', async () => {
    const accountHome = await mkdtemp(join(tmpdir(), 'dsh-codex-quota-'))
    try {
      await writeFile(join(accountHome, 'auth.json'), JSON.stringify({
        tokens: { access_token: token({ name: 'Local User' }), refresh_token: 'secret' },
      }))
      await expect(readOpenAICodexAccountName(accountHome)).resolves.toBe('Local User')
    } finally {
      await rm(accountHome, { recursive: true, force: true })
    }
  })

  it('falls back when the local Codex auth document is unavailable', async () => {
    await expect(readOpenAICodexAccountName(join(tmpdir(), 'missing-dsh-codex-home')))
      .resolves.toBeUndefined()
  })

  it('falls back for oversized or malformed local Codex auth documents', async () => {
    const accountHome = await mkdtemp(join(tmpdir(), 'dsh-codex-quota-invalid-'))
    const authFile = join(accountHome, 'auth.json')
    try {
      for (const text of [
        ' '.repeat(64 * 1024 + 1),
        '{',
        'null',
        JSON.stringify({ tokens: null }),
      ]) {
        await writeFile(authFile, text)
        await expect(readOpenAICodexAccountName(accountHome)).resolves.toBeUndefined()
      }
    } finally {
      await rm(accountHome, { recursive: true, force: true })
    }
  })
})
