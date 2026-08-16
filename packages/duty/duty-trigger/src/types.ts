/**
 * Public trigger-seam vocabulary: what a waking source reports and how it is
 * registered. This module contains types only so generated Remote clients can
 * consume it without importing Host runtime code.
 * @module @deepseek-ai/dsh-duty-trigger/types
 */

import type { DutyId, DutyRunCause } from '@deepseek-ai/dsh-duty'

/**
 * One normalized waking observation from one provider. It is a candidate, not
 * a decision: the consumer validates it against the Duty domain and either
 * claims a run or records why it skipped.
 */
export interface DutyTriggerObservation {
  /** The Duty this observation claims should wake. */
  readonly dutyId: DutyId
  /** The reporting provider's registered id, for diagnostics. */
  readonly providerId: string
  /** What woke the Duty and a human-readable statement of the cause. */
  readonly cause: DutyRunCause
  /** Provider clock time of the occurrence in Unix epoch milliseconds. */
  readonly occurredAt: number
  /**
   * Provider-computed earliest time this Duty may wake again, in Unix epoch
   * milliseconds; the consumer stores it on the Duty state so a restart keeps
   * the schedule anchored. Absent when the provider has no next occurrence.
   */
  readonly nextWakeAt?: number
}

/**
 * A waking source registered with {@link DutyTriggerService.registerProvider}.
 * The registry sweeps providers on its configured cadence; a provider computes
 * which duties are due from durable state and returns only due observations.
 * Providers must be idempotent per poll: the consumer's single-run claim
 * absorbs a duplicate report, but a provider that re-reports the same Duty
 * every poll only costs it a skipped trigger record.
 */
export interface DutyTriggerProvider {
  /** Stable provider id, unique across the registry. */
  readonly id: string
  /**
   * Report every Duty due at the given instant.
   * @param now - The registry's wall-clock reading at sweep time.
   * @returns due observations, never a thrown miscomputation: a provider
   * that cannot decide cleanly returns no observations.
   */
  poll(now: number): Promise<readonly DutyTriggerObservation[]>
}
