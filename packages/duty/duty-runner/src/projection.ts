/**
 * The `duty` session projection: one run's machine state folded
 * incrementally from its duty/* events. Clients render the live run board
 * from this unit; the host persists it through the projection cache.
 * @module @deepseek-ai/dsh-duty-runner/src/projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DutyRunMachineState, DutyStepRecord } from './types.ts'

/** Projection format version; bump only with a structural payload change. */
export const DUTY_RUN_PROJECTION_VERSION = 0

/** Wire payload schema of the `duty` projection (one run's machine state). */
export const dutyRunProjectionSchema = z.object({
  bound: z.object({
    dutyId: z.string().min(1),
    runId: z.string().min(1),
    cause: z.object({
      kind: z.union([z.literal('manual'), z.literal('schedule')]),
      reason: z.string(),
    }),
  }).optional(),
  steps: z.array(z.object({
    stepId: z.string().min(1),
    label: z.string(),
    status: z.union([z.literal('started'), z.literal('completed'), z.literal('failed')]),
    attempts: z.number().int().positive(),
    summary: z.string().optional(),
  })),
  waitingHuman: z.object({
    requestId: z.string().min(1),
    question: z.string(),
  }).optional(),
  finished: z.object({
    status: z.union([
      z.literal('running'),
      z.literal('waiting_for_human'),
      z.literal('succeeded'),
      z.literal('failed'),
      z.literal('canceled'),
    ]),
    summary: z.string().optional(),
  }).optional(),
})

/** One step record folded from a `duty/step` event payload. */
function stepRecordOf(data: {
  readonly stepId: string
  readonly label: string
  readonly status: DutyStepRecord['status']
  readonly attempts: number
  readonly summary?: string
}): DutyStepRecord {
  return {
    stepId: data.stepId,
    label: data.label,
    status: data.status,
    attempts: data.attempts,
    ...(data.summary === undefined ? {} : { summary: data.summary }),
  }
}

/**
 * Incremental fold of the `duty` projection unit. Projection-grade: every
 * non-duty event and every no-op transition returns the same state reference
 * (the registry's Object.is gate), and the runtime validated each payload
 * before appending it.
 * @param state - the projection covering all prior events.
 * @param event - the next committed session event.
 * @returns the next projection; `undefined` before the first duty event.
 */
export function applyDutyRunProjection(
  state: DutyRunMachineState | undefined,
  event: SessionEvent,
): DutyRunMachineState | undefined {
  switch (event.type) {
    case 'duty/run-bound': {
      return {
        steps: [],
        bound: { dutyId: event.data.dutyId, runId: event.data.runId, cause: event.data.cause },
      }
    }
    case 'duty/step': {
      const base = state ?? { steps: [] }
      const record = stepRecordOf(event.data)
      const index = base.steps.findIndex(step => step.stepId === record.stepId)
      const steps = index === -1
        ? [...base.steps, record]
        : base.steps.map((step, at) => at === index ? record : step)
      return { ...base, steps }
    }
    case 'duty/human-wait': {
      const base = state ?? { steps: [] }
      return { ...base, waitingHuman: { requestId: event.data.requestId, question: event.data.question } }
    }
    case 'duty/human-answer': {
      if (state?.waitingHuman?.requestId !== event.data.requestId) return state
      const { waitingHuman: _cleared, ...rest } = state
      return { ...rest }
    }
    case 'duty/run-finish': {
      // A waiting_for_human finish event is a park marker, not a terminal
      // outcome: the same Session resumes once the human answers.
      if (event.data.status === 'waiting_for_human') return state
      const base = state ?? { steps: [] }
      return {
        ...base,
        finished: {
          status: event.data.status,
          ...(event.data.summary === undefined ? {} : { summary: event.data.summary }),
        },
      }
    }
    default:
      return state
  }
}
