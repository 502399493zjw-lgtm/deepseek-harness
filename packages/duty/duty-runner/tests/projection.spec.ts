import { describe, expect, it } from 'vitest'
import { DutyId } from '@deepseek-ai/dsh-duty'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { applyDutyRunProjection, dutyRunProjectionSchema } from '../src/projection.ts'
import type { DutyRunMachineState } from '../src/types.ts'

/** Build one envelope-shaped session event for the fold. */
function event(type: string, data: object, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

describe('duty run projection', () => {
  it('stays undefined for non-duty events, returning the same reference', () => {
    const first = applyDutyRunProjection(undefined, event('user/message', { turn: 1, step: 1, message: {} }, 1))
    expect(first).toBeUndefined()
  })

  it('binds the run and accumulates step records in first-appearance order', () => {
    let state: DutyRunMachineState | undefined
    state = applyDutyRunProjection(state, event('duty/run-bound', {
      dutyId: DutyId('d1'),
      runId: 'r1',
      cause: { kind: 'schedule', reason: 'hourly' },
    }, 1))
    state = applyDutyRunProjection(state, event('duty/step', {
      stepId: 'a', label: 'Collect', status: 'started', attempts: 1,
    }, 2))
    state = applyDutyRunProjection(state, event('duty/step', {
      stepId: 'a', label: 'Collect', status: 'completed', attempts: 1, summary: '3 tickets',
    }, 3))
    state = applyDutyRunProjection(state, event('duty/step', {
      stepId: 'b', label: 'Report', status: 'started', attempts: 1,
    }, 4))
    expect(state?.bound?.runId).toBe('r1')
    expect(state?.steps.map(step => step.stepId)).toEqual(['a', 'b'])
    expect(state?.steps[0]).toMatchObject({ status: 'completed', summary: '3 tickets' })
  })

  it('opens and clears a human wait with its paired answer', () => {
    let state: DutyRunMachineState | undefined
    state = applyDutyRunProjection(state, event('duty/run-bound', {
      dutyId: DutyId('d1'), runId: 'r1', cause: { kind: 'manual', reason: 'asked' },
    }, 1))
    state = applyDutyRunProjection(state, event('duty/human-wait', {
      requestId: 'h1', question: 'Send it?',
    }, 2))
    expect(state?.waitingHuman?.requestId).toBe('h1')

    const unchanged = applyDutyRunProjection(state, event('duty/human-answer', {
      requestId: 'other', answer: 'no',
    }, 3))
    expect(unchanged).toBe(state)

    state = applyDutyRunProjection(state, event('duty/human-answer', {
      requestId: 'h1', answer: 'yes',
    }, 4))
    expect(state?.waitingHuman).toBeUndefined()
  })

  it('records a terminal outcome but not a park marker', () => {
    const bound = applyDutyRunProjection(undefined, event('duty/run-bound', {
      dutyId: DutyId('d1'), runId: 'r1', cause: { kind: 'schedule', reason: 'hourly' },
    }, 1))
    const parked = applyDutyRunProjection(bound, event('duty/run-finish', {
      status: 'waiting_for_human',
    }, 2))
    expect(parked).toBe(bound)
    expect(parked?.finished).toBeUndefined()

    const finished = applyDutyRunProjection(parked, event('duty/run-finish', {
      status: 'succeeded', summary: 'done',
    }, 3))
    expect(finished?.finished).toEqual({ status: 'succeeded', summary: 'done' })
  })

  it('folds a verdict onto its step and clears it on the next attempt', () => {
    let state: DutyRunMachineState | undefined
    state = applyDutyRunProjection(state, event('duty/run-bound', {
      dutyId: DutyId('d1'), runId: 'r1', cause: { kind: 'schedule', reason: 'hourly' },
    }, 1))
    state = applyDutyRunProjection(state, event('duty/step', {
      stepId: 'a', label: 'Collect', status: 'started', attempts: 1,
    }, 2))
    state = applyDutyRunProjection(state, event('duty/verdict', {
      stepId: 'a', pass: false, reason: 'no proof',
    }, 3))
    expect(state?.steps[0]?.lastVerdict).toEqual({ pass: false, reason: 'no proof' })

    const passed = applyDutyRunProjection(state, event('duty/verdict', {
      stepId: 'a', pass: true,
    }, 4))
    expect(passed?.steps[0]?.lastVerdict).toEqual({ pass: true })
  })

  it('creates a record for a verdict with no prior step event', () => {
    const created = applyDutyRunProjection(undefined, event('duty/verdict', {
      stepId: 'x', pass: true,
    }, 1))
    expect(created?.steps[0]).toMatchObject({ stepId: 'x', lastVerdict: { pass: true } })
  })

  it('validates a complete machine state against the wire schema', () => {
    const state: DutyRunMachineState = {
      bound: { dutyId: DutyId('d1'), runId: 'r1', cause: { kind: 'schedule', reason: 'hourly' } },
      steps: [{ stepId: 'a', label: 'Collect', status: 'completed', attempts: 1, summary: 'ok', lastVerdict: { pass: true } }],
      waitingHuman: { requestId: 'h1', question: 'Send?' },
      finished: { status: 'failed', summary: 'budget exceeded' },
    }
    expect(dutyRunProjectionSchema.safeParse(state).success).toBe(true)
  })
})
