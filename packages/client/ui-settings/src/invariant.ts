/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-settings`.
 * @module @deepseek-ai/dsh-client-ui-settings/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-settings'

/** Cordis companion plugin name. */
export const name = 'client-ui-settings-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser-only navigation store retains one latest
 * viewing-state request, while scope binding and slot contributions own their
 * lifecycles independently; no authoritative event/data relation exists to
 * compare at runtime. Slot conflicts already fail loud in the slot core.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
