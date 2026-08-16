/**
 * The timer trigger provider: sweeps every standing Duty with an interval or
 * cron waking rule and reports the ones due now. It reads only durable Duty
 * state, so a Duty wakes whether or not any Session or agent for it is live.
 * @module @deepseek-ai/dsh-duty-trigger-timer
 */

import type { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { DutyService } from '@deepseek-ai/dsh-duty'
import type {
  DutyTriggerObservation,
  DutyTriggerProvider,
} from '@deepseek-ai/dsh-duty-trigger'
import {
  CronRuleError,
  resolveCronOccurrence,
  resolveIntervalOccurrence,
} from './domain.ts'

export {
  CRON_SEARCH_HORIZON_DAYS,
  CronRuleError,
  nextCronMatch,
  parseCron,
  resolveCronOccurrence,
  resolveIntervalOccurrence,
} from './domain.ts'
export type { CronOccurrence, CronRule, IntervalOccurrence } from './domain.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'duty-trigger-timer'

/** The trigger seam this provider registers into. */
export const inject = ['dutyTriggers', 'duties']

/** Provider id registered with the trigger registry. */
export const TIMER_PROVIDER_ID = 'timer'

/** This provider has no deployment-varying policy. */
export interface Config {}

export const Config: s<Config> = s.object({})

/** Render an unknown rule failure for process-local diagnostics only. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Waking source for interval and cron Duties. One poll reads the Duty domain
 * once and reports each active, unclaimed standing Duty whose occurrence has
 * arrived, advancing past occurrences missed while the process was down:
 * exactly one observation per due Duty per poll, never one per missed period.
 */
export class TimerDutyTriggerProvider implements DutyTriggerProvider {
  readonly id = TIMER_PROVIDER_ID

  /**
   * Compose the provider over the registry's context and the Duty domain.
   * @param ctx - Registry context, for diagnostics.
   * @param duties - The Duty service whose standing Duties are swept.
   */
  constructor(
    private readonly ctx: Context,
    private readonly duties: DutyService,
  ) {}

  /**
   * Report every Duty due at the given instant.
   * @param now - The registry's wall-clock reading at sweep time.
   * @returns due observations; a Duty whose rule fails to resolve is skipped
   * with a warning rather than misreported as due.
   */
  poll(now: number): Promise<readonly DutyTriggerObservation[]> {
    const observations: DutyTriggerObservation[] = []
    for (const view of this.duties.list()) {
      const { spec, state } = view
      if (spec.mode !== 'standing') continue
      if (spec.trigger.kind === 'manual') continue
      if (state.lifecycle !== 'active' || state.running) continue
      if (state.nextWakeAt !== undefined && now < state.nextWakeAt) continue

      let decision
      try {
        decision = spec.trigger.kind === 'interval'
          ? resolveIntervalOccurrence(spec.createdAt, spec.trigger.everyMs, now)
          : resolveCronOccurrence(spec.trigger.expr, now)
      } catch (error: unknown) {
        if (error instanceof CronRuleError) {
          this.ctx.logger.warn(
            `duty-trigger-timer: invalid cron rule on duty '${spec.id}': ${error.message}`,
          )
        } else {
          this.ctx.logger.warn(
            `duty-trigger-timer: could not resolve occurrence for duty '${spec.id}': ${renderThrown(error)}`,
          )
        }
        continue
      }
      if (!decision.due) continue
      observations.push({
        dutyId: spec.id,
        providerId: TIMER_PROVIDER_ID,
        cause: { kind: 'schedule', reason: spec.trigger.description },
        occurredAt: now,
        ...(decision.nextWakeAt === undefined ? {} : { nextWakeAt: decision.nextWakeAt }),
      })
    }
    return Promise.resolve(observations)
  }
}

/**
 * Register the timer provider with the trigger registry.
 * @param ctx - Cordis context carrying the registry and the Duty domain.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.dutyTriggers.registerProvider(
    new TimerDutyTriggerProvider(ctx, ctx.duties),
  ))
}
