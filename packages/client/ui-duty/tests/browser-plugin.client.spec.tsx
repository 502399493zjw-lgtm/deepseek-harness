// @vitest-environment jsdom
// ui-duty browser plugin body: dictionary registration and the two slot
// contributions — the run dock and the sidebar panel — with their injected
// verb faces driven through a stubbed ctx.

import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import * as UiDuty from '../src/client/index.ts'

/** Capture one slots.register call's name, id, and inject face. */
interface Captured {
  name: string
  id: string
  inject: (...args: unknown[]) => unknown
}

/** A ctx stub carrying only what the plugin body reaches. */
function stubCtx(remoteDuties: Record<string, (...args: never[]) => Promise<unknown>>): {
  ctx: ClientContext
  captures: Captured[]
  dictionaries: Array<{ ns: string; zh: unknown; en: unknown }>
} {
  const captures: Captured[] = []
  const dictionaries: Array<{ ns: string; zh: unknown; en: unknown }> = []
  const registerSlot = (definition: { name: string; id?: string; inject?: (...args: unknown[]) => unknown }): unknown => {
    captures.push({
      name: definition.name,
      id: definition.id ?? '',
      inject: definition.inject ?? (() => ({})),
    })
    return () => {}
  }
  const ctx = {
    locale: {
      register: (ns: string, dict: { zh: unknown; en: unknown }) => {
        dictionaries.push({ ns, zh: dict.zh, en: dict.en })
        return () => {}
      },
    },
    slots: {
      inject: (_name: string, factory: () => unknown) => {
        factory()
        return () => {}
      },
      register: registerSlot,
    },
    sessions: {},
    remote: { duties: remoteDuties },
    effect: (fn: () => unknown) => {
      fn()
      return () => {}
    },
    get: () => undefined,
  } as unknown as ClientContext
  return { ctx, captures, dictionaries }
}

describe('ui-duty browser plugin', () => {
  it('registers the duty dictionaries and both slot entries', () => {
    const list = vi.fn(() => Promise.resolve({ ok: true, value: [] }))
    const { ctx, captures, dictionaries } = stubCtx({ list })

    UiDuty.apply(ctx)

    expect(dictionaries[0]?.ns).toBe('duty')
    expect(dictionaries[0]?.zh).toBeDefined()
    expect(dictionaries[0]?.en).toBeDefined()
    expect(captures.map(capture => `${capture.name}:${capture.id}`)).toEqual([
      'conversation.input.dock:duty',
      'sidebar.footer.action:duty',
    ])
  })

  it('exposes working verb faces over the generated Remote', async () => {
    const list = vi.fn(() => Promise.resolve({ ok: true, value: [] }))
    const answer = vi.fn(() => Promise.resolve({ ok: true, value: { id: 'h1' } }))
    const { ctx, captures } = stubCtx({ list, answer })

    UiDuty.apply(ctx)

    const panel = captures.find(capture => capture.name === 'sidebar.footer.action')
    const verbs = panel?.inject() as {
      listDuties(): Promise<unknown>
      answer(dutyId: string, requestId: string, value: string): Promise<unknown>
    }
    expect(await verbs.listDuties()).toEqual([])
    expect(await verbs.answer('d1', 'h1', 'send')).toEqual({ ok: true })
    expect(answer).toHaveBeenCalledWith('d1', 'h1', 'send')
  })

  it('maps a Remote failure into the plugin action outcome', async () => {
    const list = vi.fn(() => Promise.resolve({ ok: false, error: { code: 'boom', message: 'remote down' } }))
    const { ctx, captures } = stubCtx({ list })

    UiDuty.apply(ctx)

    const panel = captures.find(capture => capture.name === 'sidebar.footer.action')
    const verbs = panel?.inject() as { listDuties(): Promise<unknown> }
    expect(await verbs.listDuties()).toEqual([])
  })
})
