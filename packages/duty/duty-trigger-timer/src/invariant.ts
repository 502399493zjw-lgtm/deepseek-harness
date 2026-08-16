/** Package-owned invariant companion. @module @deepseek-ai/dsh-duty-trigger-timer/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-duty-trigger-timer'

/** Cordis companion plugin name. */
export const name = 'duty-trigger-timer-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the provider is a pure function of the Duty domain
 * snapshot (list, resolve, report) with no second mutable authority, the
 * registry enforces provider-id uniqueness at registration, and observations
 * are validated by the run runtime before any claim.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: [] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
