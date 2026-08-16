/**
 * Session-log events the run runtime appends. Every event is reconstructable
 * from the model-visible transcript it accompanies, honoring the
 * model-visible-if-and-only-if-logged rule, and together they fold into the
 * run machine state without any process-local cursor.
 * @module @deepseek-ai/dsh-duty-runner/src/session-events
 */

import type { DutyId, DutyRunCause, DutyRunStatus } from '@deepseek-ai/dsh-duty'
import type { DutyMessageSource } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    duty: DutyMessageSource
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * This Session belongs to one major-trigger run, appended before the
     * kickoff message so a cold fold can always recover the run identity.
     */
    'duty/run-bound': {
      readonly dutyId: DutyId
      readonly runId: string
      readonly cause: DutyRunCause
    }
    /**
     * One step entered a new attempt. Duplicates the same step's earlier
     * records; the fold keeps the newest.
     */
    'duty/step': {
      readonly stepId: string
      readonly label: string
      readonly status: 'started' | 'completed' | 'failed'
      readonly attempts: number
      readonly summary?: string
    }
    /**
     * The run parked on a durable human request. The subsequent
     * `duty/human-answer` event clears it.
     */
    'duty/human-wait': {
      readonly requestId: string
      readonly question: string
    }
    /**
     * A human answered the request this run parked on; the fold clears the
     * wait and the next instruction names the answer.
     */
    'duty/human-answer': {
      readonly requestId: string
      readonly answer: string
    }
    /**
     * The run reached its terminal outcome; the fold treats it as the end.
     */
    'duty/run-finish': {
      readonly status: DutyRunStatus
      readonly summary?: string
    }
    /**
     * One independent verification verdict for a step that reported
     * completion. A failed verdict precedes a repair attempt or a human
     * appeal.
     */
    'duty/verdict': {
      readonly stepId: string
      readonly pass: boolean
      readonly reason?: string
    }
    /**
     * One human appeal decision over a failed verdict: asked, then accepted
     * (the step completes anyway) or repair (the next attempt runs). The fold
     * keeps the latest status per step.
     */
    'duty/verdict-appeal': {
      readonly stepId: string
      readonly status: 'asked' | 'accepted' | 'repair'
    }
  }
}
