/**
 * Public run-runtime vocabulary: the machine state folded from a run's
 * Session log and the message sources the runner injects.
 * @module @deepseek-ai/dsh-duty-runner/types
 */

import type { DutyId, DutyRunCause, DutyRunStatus } from '@deepseek-ai/dsh-duty'

/**
 * A host-injected message in a run's Session: the kickoff naming the trigger
 * cause, a step instruction, or a resumed human answer. It is never an
 * end-user chat message.
 */
export interface DutyMessageSource {
  readonly kind: 'duty'
}

/** One step's progress record as derived from the run's Session log. */
export interface DutyStepRecord {
  /** Body-local step identity. */
  readonly stepId: string
  /** Short progress label shown in the run board. */
  readonly label: string
  /** How far this step has gotten. */
  readonly status: 'started' | 'completed' | 'failed'
  /** One-based attempt currently or last tried. */
  readonly attempts: number
  /** The model's one-line completion statement; absent while incomplete. */
  readonly summary?: string
}

/** A durable request the run parked on, still awaiting an answer. */
export interface DutyHumanWait {
  /** The durable human-request identity. */
  readonly requestId: string
  /** The question presented to the human. */
  readonly question: string
}

/**
 * The complete machine state of one run, folded from its Session log. The log
 * is the only authority: this state is recomputed after every idle boundary
 * and after cold resume, never held in a process-local cursor.
 */
export interface DutyRunMachineState {
  /** The run this Session belongs to; absent before the first event. */
  readonly bound?: {
    readonly dutyId: DutyId
    readonly runId: string
    readonly cause: DutyRunCause
  }
  /** Steps in first-appearance order with their latest progress. */
  readonly steps: readonly DutyStepRecord[]
  /** The open human request the run is parked on. */
  readonly waitingHuman?: DutyHumanWait
  /** Terminal outcome; present once the run finished. */
  readonly finished?: {
    readonly status: DutyRunStatus
    readonly summary?: string
  }
}
