/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-codex_shared_pool`.
 * @module @deepseek-ai/dsh-codex_shared_pool/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-codex_shared_pool'

/** Cordis companion plugin name. */
export const name = 'codex-shared-pool-bundle-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: this package is a static patch-list carrier. The Host
// and browser packages own the mutable relationships introduced by its rows.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
