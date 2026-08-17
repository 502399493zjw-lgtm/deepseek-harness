// @vitest-environment jsdom
import { cleanup } from '@testing-library/react'
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applySettings } from '@deepseek-ai/dsh-client-ui-settings/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, inject, NS } from '../src/client/quota/index.ts'
import {
  CodexQuotaFooter,
  type CodexQuotaFooterFace,
} from '../src/client/quota/CodexQuotaFooter.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const SNAPSHOT = {
  currentAccountName: '经纬 钟',
  currentRemainingPercent: 73,
  currentResetsAt: null,
  poolAccountCount: 12,
  poolRemainingPercent: 61,
  refreshedAt: 1,
} as const

type ReadResult =
  | { readonly ok: true; readonly value: typeof SNAPSHOT }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  await ctx.plugin({ apply: applySettings }).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const read = vi.fn<() => Promise<ReadResult>>()
    .mockResolvedValue({ ok: true, value: SNAPSHOT })
  ctx.provide('remote.codexQuota', { read })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, read }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('unified Codex quota browser contribution', () => {
  it('registers in the sidebar and routes to the shared Codex settings page', async () => {
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.codexQuota', 'settingsNavigation',
    ])
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('sidebar.footer.action')[0]!
    expect(entry.component).toBe(CodexQuotaFooter)
    expect(entry.options).toMatchObject({ id: 'codex-quota', order: -1000 })
    expect(entry.locale).toBe(NS)
    expect(b.read).not.toHaveBeenCalled()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const injected = (entry.inject as unknown as () => CodexQuotaFooterFace)()
    injected.openSettings()
    expect(b.ctx.settingsNavigation.requests.getSnapshot()).toMatchObject({
      sectionId: 'openai-codex',
    })
    await expect(injected.read()).resolves.toEqual(SNAPSHOT)
    b.read.mockResolvedValueOnce({
      ok: false,
      error: { code: 'REMOTE_ERROR', message: 'unavailable' },
    })
    await expect(injected.read()).rejects.toThrow(
      'codexQuota.read failed: REMOTE_ERROR: unavailable',
    )
    await b.ctx.fiber.dispose()
  })

  it('waits for the sidebar slot and withdraws on unload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('sidebar.footer.action')[0]?.component).toBe(CodexQuotaFooter)
    })
    stop()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)

    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('sidebar.footer.action')).toHaveLength(1)
    })
    await fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    await b.ctx.fiber.dispose()
  })
})
