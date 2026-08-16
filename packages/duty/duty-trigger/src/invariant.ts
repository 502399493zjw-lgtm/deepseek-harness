/** Package-owned invariant companion. @module @deepseek-ai/dsh-duty-trigger/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-duty-trigger'

/** Cordis companion plugin name. */
export const name = 'duty-trigger-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: provider ids are unique by a registration-time throw,
 * sweeps are process-local disposable projections with no durable second
 * authority, and the run runtime validates every observation against the Duty
 * domain before claiming, so no event/data relation exists here to assert.
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
