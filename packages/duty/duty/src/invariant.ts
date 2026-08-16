/** Package-owned invariant companion. @module @deepseek-ai/dsh-duty/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DutyId, DutyRun } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-duty'

/** Cordis companion plugin name. */
export const name = 'duty-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * A Duty holding its run claim must have exactly one unsettled run, and a Duty
 * holding no claim must have none. The claim is what stops a second trigger
 * from starting a concurrent run, so a claim that disagrees with the run
 * history means either a lost wakeup or a double-run.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'duty') return
    if (change.table !== 'state' && change.table !== 'runs') return
    const dutyId = change.key as DutyId
    const view = ctx.duties.get(dutyId)
    if (view === undefined) return
    const unsettled = ctx.duties.runsOf(dutyId).filter((run: DutyRun) =>
      run.status === 'running' || run.status === 'waiting_for_human')
    if (view.state.running && unsettled.length !== 1) {
      fail(`duty '${dutyId}' holds its run claim with ${unsettled.length} unsettled runs`)
    }
    if (!view.state.running && unsettled.length !== 0) {
      fail(`duty '${dutyId}' released its run claim leaving ${unsettled.length} unsettled runs`)
    }
  })
}, { inject: ['duties'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
