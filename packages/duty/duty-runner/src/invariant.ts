/** Package-owned invariant companion. @module @deepseek-ai/dsh-duty-runner/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-duty-runner'

/** Cordis companion plugin name. */
export const name = 'duty-runner-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the runner holds no durable second authority — every
 * machine fact is a Session event folded on demand, and the durable claim and
 * run records are owned and checked by dsh-duty's invariant.
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
