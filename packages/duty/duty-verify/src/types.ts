/**
 * Public verification-seam vocabulary: what the run runtime asks before
 * accepting a step completion, and how a verifier answers.
 * @module @deepseek-ai/dsh-duty-verify/types
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DutyId, DutyRunId, DutyStep } from '@deepseek-ai/dsh-duty'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * One bounded line of evidence for the verifier. The runtime renders the run
 * Session's current-step window into plain lines; the verifier never reads the
 * log itself, so the evidence bundle is the whole input surface.
 */
export interface DutyVerificationEvidence {
  /** Event kind or role of the line, for orientation only. */
  readonly kind: string
  /** One rendered line; already byte-bounded by the runtime. */
  readonly text: string
}

/** One verification request for a step that reported completion. */
export interface DutyVerificationRequest {
  /** The Duty whose run is being verified. */
  readonly dutyId: DutyId
  /** The run being verified. */
  readonly runId: DutyRunId
  /** The run's Session identity. */
  readonly sessionId: SessionId
  /** The step that reported completion. */
  readonly step: DutyStep
  /** The model's one-line completion summary from `duty_step_done`. */
  readonly summary: string
  /** The bounded evidence bundle rendered by the runtime. */
  readonly evidence: readonly DutyVerificationEvidence[]
  /** The live run Agent; verifiers that delegate pass it as the subagent parent. */
  readonly parent: Agent
}

/**
 * One independent verdict. A failed verdict sends the step back through the
 * repair loop; a passed verdict lets the cursor advance past the step.
 */
export interface DutyVerdict {
  readonly pass: boolean
  /** Why the verdict failed; absent when passed. */
  readonly reason?: string
}

/**
 * An independent completion checker registered with
 * {@link DutyVerifierRegistry.register}. Verifiers must be deterministic in
 * their inputs (the evidence bundle); infrastructure failures throw, and the
 * runtime treats a thrown verifier as a failed verification rather than a
 * silent pass.
 */
export interface DutyVerifier {
  /** Stable verifier id, unique across the registry. */
  readonly id: string
  /**
   * Judge one reported step completion.
   * @param request - the step, its summary, and the bounded evidence.
   * @returns the verdict, or a thrown infrastructure failure.
   */
  verify(request: DutyVerificationRequest): Promise<DutyVerdict>
}
