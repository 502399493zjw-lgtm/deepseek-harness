/** Package-owned invariant companion. @module @deepseek-ai/dsh-client-ui-duty/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-duty'

/** Cordis companion plugin name. */
export const name = 'ui-duty-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the browser half is pure presentation over the
 * `duty` session projection and the generated duties Remote; both own and
 * check their authoritative sources on the Host, and this plugin keeps no
 * second authority.
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
