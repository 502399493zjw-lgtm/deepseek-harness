/**
 * The Duty trigger seam: a provider registry that sweeps registered waking
 * sources on a fixed cadence and publishes their observations as `duty/trigger`
 * events. The registry owns timing and containment; providers own due-math;
 * the run runtime (a separate Consumer) owns claim, dedupe, and execution.
 *
 * The seam exists because waking a standing Duty must outlive any one Session
 * or agent: providers read the durable Duty domain, not a live transcript.
 * @module @deepseek-ai/dsh-duty-trigger
 */

import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import type { DutyTriggerObservation, DutyTriggerProvider } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dutyTriggers: DutyTriggerService
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One provider's waking observation, published per sweep in provider
     * registration order. Listeners consume the candidate: they may claim a
     * run, record a skip, or ignore it; the registry makes no decision.
     * @param observation - the normalized waking observation.
     * @mode emit
     */
    'duty/trigger'(observation: DutyTriggerObservation): void
  }
}

/**
 * Registry cadence policy. The upper bound keeps the sweep strictly below one
 * minute so a calendar trigger matching a whole minute can never be skipped
 * between two sweeps.
 */
export interface Config {
  /**
   * Milliseconds between sweep starts, a whole millisecond from 1000 to 60000.
   */
  readonly pollIntervalMs: number
}

/** Render an unknown provider failure for process-local diagnostics only. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/**
 * Registry of waking sources. Providers register idempotently; one sweep polls
 * every registered provider once at the current wall clock and emits each
 * returned observation. Sweeps never overlap: the next timer arms after the
 * current sweep settles, re-reading the clock rather than accumulating drift.
 */
export class DutyTriggerService extends Service {
  /** Loader validation for the required sweep cadence. */
  static Config: s<Config> = s.object({
    pollIntervalMs: s.number().step(1).min(1000).max(60000).required(),
  })

  private readonly policy: Config
  private readonly providers = new Map<string, DutyTriggerProvider>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private activeSweep: Promise<void> | undefined
  private stopping = false

  /**
   * Compose the registry and adopt its cadence policy.
   * @param ctx - Cordis context; the registry itself depends on no service.
   * @param config - Validated sweep cadence.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dutyTriggers')
    this.policy = config
  }

  /** Arm the first sweep; the timer disarms when the service fiber unloads. */
  protected [Service.init](): void {
    this.arm(this.policy.pollIntervalMs)
    this.ctx.effect(() => () => {
      this.stopping = true
      this.clearTimer()
    })
  }

  /**
   * Register one waking source.
   * @param provider - The provider to register under its id.
   * @returns the disposer that unregisters it.
   */
  registerProvider(provider: DutyTriggerProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`duty-trigger: provider '${provider.id}' is already registered`)
    }
    this.providers.set(provider.id, provider)
    return () => {
      this.providers.delete(provider.id)
    }
  }

  /**
   * Registered provider ids, in registration order.
   * @returns the current provider id list.
   */
  providerIds(): readonly string[] {
    return [...this.providers.keys()]
  }

  /**
   * Run one complete sweep now, polling every provider at the current wall
   * clock and emitting each observation. Concurrent callers share the one
   * in-flight sweep.
   * @returns resolution after every provider has been polled and every
   * observation emitted.
   */
  sweep(): Promise<void> {
    return (this.activeSweep ??= this.performSweep().finally(() => {
      this.activeSweep = undefined
    }))
  }

  /** Poll every provider serially, containing provider failures per provider. */
  private async performSweep(): Promise<void> {
    const now = Date.now()
    for (const provider of [...this.providers.values()]) {
      let observations: readonly DutyTriggerObservation[]
      try {
        observations = await provider.poll(now)
      } catch (error: unknown) {
        // One failing provider must not stall the sweep or hide other due work.
        this.ctx.logger.warn(`duty-trigger: provider '${provider.id}' failed: ${renderThrown(error)}`)
        continue
      }
      for (const observation of observations) {
        this.ctx.emit('duty/trigger', observation)
      }
    }
  }

  /** Cancel the armed timer, if any. */
  private clearTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Arm the next sweep; each wake re-reads the wall clock inside the sweep. */
  private arm(delay: number): void {
    if (this.stopping) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.sweep().finally(() => {
        if (!this.stopping) this.arm(this.policy.pollIntervalMs)
      })
    }, delay)
  }
}

export default DutyTriggerService
