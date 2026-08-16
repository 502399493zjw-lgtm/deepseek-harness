/**
 * Public Duty vocabulary: the durable responsibility contract, its operational
 * state, major-trigger run records, and human-decision records.
 *
 * This module contains types only so generated Remote clients and browser
 * plugins can consume it without importing Host runtime code.
 * @module @deepseek-ai/dsh-duty/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'

/** Stable identity of one durable responsibility. */
export type DutyId = Branded<'DutyId'>

/** Stable identity of one major-trigger run. */
export type DutyRunId = Branded<'DutyRunId'>

/** Stable identity of one durable human-decision request. */
export type HumanRequestId = Branded<'HumanRequestId'>

// The factories live beside their types (the dsh-session SessionId
// precedent): a type and a value of one name must be declared in one module
// for a re-export to carry both meanings.

/**
 * Brand a string as a {@link DutyId}.
 * @param id - Raw duty id string.
 * @returns the same string, branded at compile time.
 */
export function DutyId(id: string): DutyId {
  return id as DutyId
}

/**
 * Brand a string as a {@link DutyRunId}.
 * @param id - Raw run id string.
 * @returns the same string, branded at compile time.
 */
export function DutyRunId(id: string): DutyRunId {
  return id as DutyRunId
}

/**
 * Brand a string as a {@link HumanRequestId}.
 * @param id - Raw request id string.
 * @returns the same string, branded at compile time.
 */
export function HumanRequestId(id: string): HumanRequestId {
  return id as HumanRequestId
}

/** Opaque compare-and-set token for one exact Duty revision. */
export type DutyVersion = Branded<'DutyVersion'>

/**
 * How a Duty presents to the user. A Duty without a waking trigger runs once;
 * one with a trigger stays on duty. The distinction is presentation, not a
 * second execution path.
 */
export type DutyMode = 'once' | 'standing'

/** Whether a Duty may currently be woken. */
export type DutyLifecycle = 'draft' | 'active' | 'paused' | 'archived'

/**
 * Whether step completion requires an independent verdict, and which verifier
 * judges it. `off` skips verification; `on` uses the registry's configured
 * default verifier; any other non-empty string names a specific registered
 * verifier id. A failed verdict sends the step back through repair. Defaults
 * to `off`.
 */
export type DutyVerification = 'off' | 'on' | (string & {})

/** Why a Duty stopped waking itself. */
export type DutyPauseReason = 'failures' | 'budget' | 'escalation' | 'human'

/**
 * A waking source that creates one user-visible run. `manual` never fires on
 * its own; `interval` and `cron` are swept by a trigger provider.
 */
export type DutyTriggerKind = 'manual' | 'interval' | 'cron'

/** A fixed-rate waking rule anchored to its creation time. */
export interface IntervalTrigger {
  readonly kind: 'interval'
  /** Human-readable statement of when this fires. */
  readonly description: string
  /** Fixed safe-integer period in milliseconds. */
  readonly everyMs: number
}

/** A calendar waking rule in five-field cron syntax. */
export interface CronTrigger {
  readonly kind: 'cron'
  /** Human-readable statement of when this fires. */
  readonly description: string
  /** Five-field cron expression, numeric fields only. */
  readonly expr: string
}

/** A Duty woken only by an explicit human or model request. */
export interface ManualTrigger {
  readonly kind: 'manual'
  /** Human-readable statement of when this fires. */
  readonly description: string
}

/** The waking rule of one Duty; switch on `kind`. */
export type DutyTrigger = ManualTrigger | IntervalTrigger | CronTrigger

/**
 * One node of the execution body. `agent` is a single delegated turn,
 * `parallel` fans its children out concurrently, and `phase` groups children
 * under a progress label without changing concurrency.
 */
export type DutyStepKind = 'agent' | 'parallel' | 'phase'

/** One declared execution step. */
export interface DutyStep {
  /** Body-local identity, unique among its siblings. */
  readonly id: string
  /** Which execution behavior this step selects. */
  readonly kind: DutyStepKind
  /** Short progress label shown in the run board. */
  readonly label: string
  /** Instruction delivered for an `agent` step. */
  readonly prompt?: string
  /** Children of a `parallel` or `phase` step. */
  readonly children?: readonly DutyStep[]
}

/**
 * The declared execution body. It is structured data the runtime interprets,
 * never evaluated source text, so a body change is reviewable as a diff.
 */
export interface DutyBody {
  /** Ordered top-level steps. */
  readonly steps: readonly DutyStep[]
}

/**
 * What the Duty may spend and which tools it may reach. The tool allowance is
 * enforced by the executing Agent's registered tool set, not by instructions.
 */
export interface DutyToolPolicy {
  /** Tool names the run's Agent may call; an empty list grants none. */
  readonly allow: readonly string[]
  /** Tool names that require a durable human decision before running. */
  readonly gated: readonly string[]
}

/** Bounds that stop a Duty rather than letting it spin or overspend. */
export interface DutyLimits
{
  /** Consecutive failed runs tolerated before the Duty pauses. */
  readonly maxConsecutiveFailures: number
  /** Per-run cost ceiling in USD; exceeding it fails and pauses the run. */
  readonly budgetUsd?: number
}

/**
 * The durable responsibility contract. It states what should happen, when, with
 * which tools and budget, and how the result is reported.
 */
export interface DutySpec {
  readonly id: DutyId
  /** Short human-facing name. */
  readonly title: string
  /** Whether this presents as a one-time or standing responsibility. */
  readonly mode: DutyMode
  /** Intended outcome in the user's own terms. */
  readonly goal: string
  /** What the Duty must not do, in the user's own terms. */
  readonly scope?: string
  /** The waking rule. */
  readonly trigger: DutyTrigger
  /** Whether step completion requires an independent verdict. */
  readonly verification: DutyVerification
  /** The declared execution body. */
  readonly body: DutyBody
  /** Tool allowance and gating. */
  readonly toolPolicy: DutyToolPolicy
  /** Failure and budget bounds. */
  readonly limits: DutyLimits
  /** Conditions under which the Duty asks a human instead of proceeding. */
  readonly escalation: readonly string[]
  /** Where and how results are reported. */
  readonly reporting?: string
  /** Optional owning project grouping. */
  readonly projectId?: string
  /** Equality-only token replaced by every accepted spec mutation. */
  readonly version: DutyVersion
  /** Host-assigned creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Host-assigned time of the most recent accepted spec mutation. */
  readonly updatedAt: number
}

/**
 * Operational progress across major triggers. It answers where the Duty is in
 * its lifecycle; it holds no transcript, no evidence, and no learned knowledge.
 */
export interface DutyState {
  readonly dutyId: DutyId
  /** Whether the Duty may currently be woken. */
  readonly lifecycle: DutyLifecycle
  /** Present exactly while `lifecycle` is `paused`. */
  readonly pausedReason?: DutyPauseReason
  /** Count of runs started, and the number the next run receives. */
  readonly runCount: number
  /** Whether a run currently holds this Duty's single-run claim. */
  readonly running: boolean
  /** Identity of the most recently started run. */
  readonly lastRunId?: DutyRunId
  /** Start time of the most recent run in Unix epoch milliseconds. */
  readonly lastRunAt?: number
  /** Outcome of the most recently settled run. */
  readonly lastOutcome?: DutyRunStatus
  /** Earliest time the trigger may fire again, in Unix epoch milliseconds. */
  readonly nextWakeAt?: number
  /** Consecutive failed runs since the last success. */
  readonly consecutiveFailures: number
  /**
   * Opaque JSON progress marker advanced only by a run that completed. A
   * crash mid-run therefore never advances past unfinished work.
   */
  readonly cursor?: JsonValue
}

/** How one run ended, or that it has not ended. */
export type DutyRunStatus =
  | 'running'
  | 'waiting_for_human'
  | 'succeeded'
  | 'failed'
  | 'canceled'

/** What woke one run. */
export type DutyRunCauseKind = 'manual' | 'schedule'

/** The waking cause recorded on a run, used to explain why it ran. */
export interface DutyRunCause {
  /** Which waking source created this run. */
  readonly kind: DutyRunCauseKind
  /** Human-readable statement of the cause, shown in the run board. */
  readonly reason: string
}

/**
 * One user-visible run: exactly one per major trigger. Retries, repairs, and
 * human responses are later turns of this run's single Session, not new runs.
 */
export interface DutyRun {
  readonly id: DutyRunId
  readonly dutyId: DutyId
  /** Monotonic per-Duty run number, starting at 1. */
  readonly index: number
  /** The Session that owns this run's complete transcript. */
  readonly sessionId: SessionId
  /** What woke this run. */
  readonly cause: DutyRunCause
  /** Current or final status. */
  readonly status: DutyRunStatus
  /** Start time in Unix epoch milliseconds. */
  readonly startedAt: number
  /** Settle time in Unix epoch milliseconds; absent while running. */
  readonly completedAt?: number
  /** Short outcome statement shown in the run list. */
  readonly summary?: string
  /** Whether the executing Agent adapted the stored body for this run. */
  readonly adapted: boolean
  /** Recorded USD cost attributed to this run. */
  readonly costUsd?: number
}

/** Why a run needs a human before it can continue. */
export type HumanRequestReason = 'missing_info' | 'authorization' | 'choice' | 'blocked'

/** Whether a human decision is still awaited. */
export type HumanRequestStatus = 'open' | 'answered' | 'canceled'

/**
 * A durable request for a human decision. It outlives the asking process, so a
 * Duty woken overnight can park and be answered the next morning.
 */
export interface HumanRequest {
  readonly id: HumanRequestId
  readonly dutyId: DutyId
  readonly runId: DutyRunId
  /** The Session that resumes when this is answered. */
  readonly sessionId: SessionId
  /** Whether a decision is still awaited. */
  readonly status: HumanRequestStatus
  /** Why the run cannot proceed unaided. */
  readonly reason: HumanRequestReason
  /** The question presented to the human. */
  readonly question: string
  /** Offered choices; an empty list means free-form only. */
  readonly options: readonly string[]
  /** Whether an answer outside `options` is accepted. */
  readonly allowFreeform: boolean
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Answer time in Unix epoch milliseconds; absent while open. */
  readonly answeredAt?: number
  /** The human's verbatim answer; absent while open. */
  readonly answer?: string
}

/**
 * One recorded waking decision, including a decision not to run. It answers why
 * a Duty ran or did not run at a given moment.
 */
export interface DutyTriggerEvent {
  /** Event-local identity within its Duty. */
  readonly id: string
  readonly dutyId: DutyId
  /** What the trigger claimed to observe. */
  readonly cause: DutyRunCause
  /** Whether this event started a run. */
  readonly matched: boolean
  /** Why no run started; absent when `matched`. */
  readonly skippedReason?: DutySkipReason
  /** The run this event created; absent when skipped. */
  readonly runId?: DutyRunId
  /** Observation time in Unix epoch milliseconds. */
  readonly createdAt: number
}

/** Why a waking decision did not start a run. */
export type DutySkipReason =
  | 'paused'
  | 'archived'
  | 'running'
  | 'not-due'
  | 'draft'

/** Fields accepted when creating a Duty; the Host assigns the rest. */
export interface CreateDutyRequest {
  /**
   * Optional caller-supplied identity (a UUID) for idempotent creation: a
   * retry with the same id rejects with `duty-exists` instead of minting a
   * second Duty. The Host validates the format and uniqueness.
   */
  readonly id?: string
  readonly title: string
  readonly goal: string
  readonly scope?: string
  readonly trigger: DutyTrigger
  readonly verification?: DutyVerification
  readonly body: DutyBody
  readonly toolPolicy: DutyToolPolicy
  readonly limits?: Partial<DutyLimits>
  readonly escalation?: readonly string[]
  readonly reporting?: string
  readonly projectId?: string
}

/** Fields replaceable by an edit; at least one must be present. */
export interface EditDutyRequest {
  readonly title?: string
  readonly goal?: string
  readonly scope?: string
  readonly trigger?: DutyTrigger
  readonly verification?: DutyVerification
  readonly body?: DutyBody
  readonly toolPolicy?: DutyToolPolicy
  readonly limits?: Partial<DutyLimits>
  readonly escalation?: readonly string[]
  readonly reporting?: string
  readonly projectId?: string
}

/** A Duty together with its current operational state. */
export interface DutyView {
  readonly spec: DutySpec
  readonly state: DutyState
}
