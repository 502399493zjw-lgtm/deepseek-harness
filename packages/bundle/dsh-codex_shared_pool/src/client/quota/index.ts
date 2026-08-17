/** Codex account-pool quota contribution for the sidebar footer. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CodexQuotaFooter,
  type CodexQuotaFooterFace,
} from './CodexQuotaFooter.tsx'
import type { CodexQuotaReadFace } from './useCodexQuota.ts'
import { en, zh, type CodexQuotaLocaleKey } from './locales.ts'

export type {
  CodexQuotaFooterFace,
  CodexQuotaFooterProps,
} from './CodexQuotaFooter.tsx'
export type { CodexQuotaLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Codex account and quota copy. */
    'codex.quota': CodexQuotaLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'codex.quota'

/** Services required by the sidebar registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.codexQuota', 'settingsNavigation']

/** Register the quota block before every existing sidebar footer action. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-codex-shared-pool: quota dictionaries')

  const read: CodexQuotaReadFace['read'] = async () => {
    const result = await ctx.remote.codexQuota.read()
    if (!result.ok) {
      throw new Error(`codexQuota.read failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'codex-quota',
    order: -1000,
    locale: NS,
    inject: (): CodexQuotaFooterFace => ({
      read,
      openSettings: () => { ctx.settingsNavigation.openSection('openai-codex') },
    }),
  }, CodexQuotaFooter))
}
