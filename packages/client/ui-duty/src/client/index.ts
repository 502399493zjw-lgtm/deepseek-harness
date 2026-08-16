/**
 * Duty surface plugin, browser half: the live run board docked above the
 * composer for run Sessions, and the duty list/run history/human inbox panel
 * at the sidebar foot. The dock renders only from the `duty` session
 * projection; the panel's reads and mutations ride the generated duties
 * Remote, so this plugin owns no store and no refresh chain beyond its own
 * component-local state.
 */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the footer.action entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the `duty` SessionProjectionMap key merge (single source, the domain's outlet).
import type {} from '@deepseek-ai/dsh-duty-runner/client'
import type { DutyId, DutyLifecycle, DutyPauseReason, HumanRequestId } from '@deepseek-ai/dsh-api-remotes/client'
import type { DutyActionResult, DutyPanelActions, DutyRunDockActions } from './slots.ts'
import { DutyRunDock } from './DutyRunDock.tsx'
import { DutyPanel } from './DutyPanel.tsx'
import { en, zh, type DutyKey } from './locales.ts'

export { DutyPanel } from './DutyPanel.tsx'
export { DutyRunDock } from './DutyRunDock.tsx'
export type { DutyActionResult, DutyPanelActions, DutyRunDockActions, DutyRowView } from './slots.ts'
export type { DutyKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The duty surface's copy. */
    duty: DutyKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'duty'

/** Required services for the run dock, the panel, Remote mutations, and copy. */
export const inject = ['slots', 'sessions', 'remote', 'remote.duties', 'locale']

/** Unwrap one generated Remote result into the plugin's own action outcome. */
function actionOf(result: { ok: true; value: unknown } | { ok: false; error: { message: string } }): DutyActionResult {
  if (result.ok) return { ok: true }
  return { ok: false, error: result.error.message }
}

/**
 * Client plugin body: the run dock, the sidebar panel, and the dictionaries.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => () => {
    // Locale dictionaries are process-static; the effect carries no cleanup.
  })
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-duty: dictionaries')

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'duty',
    order: 20,
    locale: NS,
    inject: (_sessionId: SessionId): DutyRunDockActions => ({
      answer: async (dutyId: DutyId, requestId: string, answer: string) => {
        const result = await ctx.remote.duties.answer(dutyId, requestId as HumanRequestId, answer)
        return actionOf(result)
      },
    }),
  }, DutyRunDock))

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'duty',
    order: 20,
    locale: NS,
    inject: (): DutyPanelActions => ({
      listDuties: async () => {
        const result = await ctx.remote.duties.list()
        return result.ok ? result.value : []
      },
      listRuns: async (id: DutyId) => {
        const result = await ctx.remote.duties.runsOf(id)
        return result.ok ? result.value : []
      },
      openRequests: async () => {
        const result = await ctx.remote.duties.openRequests()
        return result.ok ? result.value : []
      },
      answer: async (dutyId: DutyId, requestId: string, answer: string) => {
        const result = await ctx.remote.duties.answer(dutyId, requestId as HumanRequestId, answer)
        return actionOf(result)
      },
      setLifecycle: async (id: DutyId, lifecycle: DutyLifecycle, reason?: string) => {
        const result = await ctx.remote.duties.setLifecycle(id, lifecycle, reason as DutyPauseReason | undefined)
        return actionOf(result)
      },
      start: async (id: DutyId, reason: string) => {
        const result = await ctx.remote.duties.start(id, reason)
        if (!result.ok) return { ok: false, error: result.error.message }
        return result.value.ok ? { ok: true } : { ok: false, error: result.value.error }
      },
      remove: async (id: DutyId) => {
        const result = await ctx.remote.duties.remove(id)
        return actionOf(result)
      },
    }),
  }, DutyPanel))
}
