/**
 * Pure replay fold of one run's Session log into its machine state. The fold
 * is deterministic over the event stream, so a parked run resumes after a
 * restart by refolding the persisted log.
 * @module @deepseek-ai/dsh-duty-runner/src/machine
 */

import type { DutyStep } from '@deepseek-ai/dsh-duty'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DutyRunMachineState, DutyStepRecord } from './types.ts'

/**
 * Fold a run's Session events into its current machine state.
 * @param events - The complete event stream of the run's Session.
 * @returns the folded state: binding, step progress in first-appearance
 * order, any open human wait, and the terminal outcome when present.
 */
export function foldRunMachine(events: readonly SessionEvent[]): DutyRunMachineState {
  let bound: DutyRunMachineState['bound']
  let waitingHuman: DutyRunMachineState['waitingHuman']
  let finished: DutyRunMachineState['finished']
  const steps = new Map<string, DutyStepRecord>()
  const ordered: DutyStepRecord[] = []
  for (const event of events) {
    switch (event.type) {
      case 'duty/run-bound': {
        bound = { dutyId: event.data.dutyId, runId: event.data.runId, cause: event.data.cause }
        break
      }
      case 'duty/step': {
        const { data } = event
        const record: DutyStepRecord = {
          stepId: data.stepId,
          label: data.label,
          status: data.status,
          attempts: data.attempts,
          ...(data.summary === undefined ? {} : { summary: data.summary }),
        }
        const existing = steps.get(data.stepId)
        if (existing === undefined) {
          steps.set(data.stepId, record)
          ordered.push(record)
        } else {
          Object.assign(existing, record)
        }
        break
      }
      case 'duty/human-wait': {
        waitingHuman = { requestId: event.data.requestId, question: event.data.question }
        break
      }
      case 'duty/human-answer': {
        if (waitingHuman?.requestId === event.data.requestId) waitingHuman = undefined
        break
      }
      case 'duty/verdict': {
        const { data } = event
        const record: DutyStepRecord = {
          stepId: data.stepId,
          label: data.stepId,
          status: 'started',
          attempts: 1,
          lastVerdict: {
            pass: data.pass,
            ...(data.reason === undefined ? {} : { reason: data.reason }),
          },
        }
        const existing = steps.get(data.stepId)
        if (existing === undefined) {
          steps.set(data.stepId, record)
          ordered.push(record)
        } else {
          Object.assign(existing, { lastVerdict: record.lastVerdict })
        }
        break
      }
      case 'duty/run-finish': {
        // A waiting_for_human finish event is a park marker, not a terminal
        // outcome: the same Session resumes once the human answers.
        if (event.data.status !== 'waiting_for_human') {
          finished = {
            status: event.data.status,
            ...(event.data.summary === undefined ? {} : { summary: event.data.summary }),
          }
        }
        break
      }
      default:
        // Every other event type is transcript content, invisible to the
        // machine; the switch stays open so foreign events fold through.
        break
    }
  }
  return {
    steps: ordered,
    ...(bound === undefined ? {} : { bound }),
    ...(waitingHuman === undefined ? {} : { waitingHuman }),
    ...(finished === undefined ? {} : { finished }),
  }
}

/**
 * The body-local step id the machine should work on next: the first step that
 * has not completed. The body order comes from the caller, which knows the
 * stored or adapted contract; the fold only reports progress.
 * @param bodyStepIds - Ordered step ids of the stored or adapted body.
 * @param state - The folded machine state.
 * @returns the next incomplete step id, or `undefined` when all are complete.
 */
export function nextIncompleteStepId(
  bodyStepIds: readonly string[],
  state: DutyRunMachineState,
): string | undefined {
  const records = new Map(state.steps.map(step => [step.stepId, step]))
  return bodyStepIds.find(id => records.get(id)?.status !== 'completed')
}

/**
 * Collect every step id of one body in depth-first execution order, matching
 * the sequential execution order of `agent` and `phase` steps (a `parallel`
 * step's children are collected but fan out at execution time).
 * @param steps - The body's top-level steps.
 * @returns the ordered step ids.
 */
export function flattenStepIds(steps: readonly DutyStep[]): string[] {
  const ids: string[] = []
  const visit = (step: DutyStep): void => {
    ids.push(step.id)
    for (const child of step.children ?? []) visit(child)
  }
  for (const step of steps) visit(step)
  return ids
}
