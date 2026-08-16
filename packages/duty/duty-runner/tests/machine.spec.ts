import { describe, expect, it } from 'vitest'
import { DutyId } from '@deepseek-ai/dsh-duty'
import type { DutyRunCause } from '@deepseek-ai/dsh-duty'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { flattenStepIds, foldRunMachine, nextIncompleteStepId } from '../src/machine.ts'

const CAUSE: DutyRunCause = { kind: 'schedule', reason: 'the hourly trigger fired' }

/** Build one envelope-shaped session event for the fold. */
function event(type: string, data: object, seq: number): SessionEvent {
  return { type, seq, time: seq, data } as unknown as SessionEvent
}

describe('run machine fold', () => {
  it('recovers the run binding from the bound event', () => {
    const state = foldRunMachine([
      event('duty/run-bound', { dutyId: DutyId('d1'), runId: 'r1', cause: CAUSE }, 1),
    ])
    expect(state.bound).toEqual({ dutyId: DutyId('d1'), runId: 'r1', cause: CAUSE })
    expect(state.steps).toHaveLength(0)
  })

  it('keeps the newest record per step in first-appearance order', () => {
    const state = foldRunMachine([
      event('duty/step', { stepId: 'a', label: 'Collect', status: 'started', attempts: 1 }, 1),
      event('duty/step', { stepId: 'a', label: 'Collect', status: 'started', attempts: 2 }, 2),
      event('duty/step', { stepId: 'a', label: 'Collect', status: 'completed', attempts: 2, summary: '3 tickets' }, 3),
      event('duty/step', { stepId: 'b', label: 'Report', status: 'started', attempts: 1 }, 4),
    ])
    expect(state.steps.map(step => step.stepId)).toEqual(['a', 'b'])
    expect(state.steps[0]).toMatchObject({ status: 'completed', attempts: 2, summary: '3 tickets' })
  })

  it('opens and clears a human wait with its paired answer', () => {
    const state = foldRunMachine([
      event('duty/human-wait', { requestId: 'h1', question: 'Send it?' }, 1),
    ])
    expect(state.waitingHuman).toEqual({ requestId: 'h1', question: 'Send it?' })

    const answered = foldRunMachine([
      event('duty/human-wait', { requestId: 'h1', question: 'Send it?' }, 1),
      event('duty/human-answer', { requestId: 'h1', answer: 'yes' }, 2),
    ])
    expect(answered.waitingHuman).toBeUndefined()
  })

  it('attaches the latest verdict to its step, latest wins', () => {
    const state = foldRunMachine([
      event('duty/step', { stepId: 'a', label: 'Collect', status: 'started', attempts: 1 }, 1),
      event('duty/verdict', { stepId: 'a', pass: false, reason: 'no proof' }, 2),
      event('duty/verdict', { stepId: 'a', pass: true }, 3),
    ])
    expect(state.steps[0]?.lastVerdict).toEqual({ pass: true })
  })

  it('creates a step record for a verdict without a prior step event', () => {
    const state = foldRunMachine([
      event('duty/verdict', { stepId: 'b', pass: false, reason: 'no proof' }, 1),
    ])
    expect(state.steps[0]).toMatchObject({ stepId: 'b', lastVerdict: { pass: false, reason: 'no proof' } })
  })

  it('records the terminal outcome', () => {
    const state = foldRunMachine([
      event('duty/run-finish', { status: 'succeeded', summary: 'done' }, 1),
    ])
    expect(state.finished).toEqual({ status: 'succeeded', summary: 'done' })
  })

  it('ignores transcript events', () => {
    const state = foldRunMachine([
      event('user/message', { turn: 1, step: 1, message: {} }, 1),
      event('assistant/message', { turn: 1, step: 1, message: {} }, 2),
    ])
    expect(state.bound).toBeUndefined()
    expect(state.steps).toHaveLength(0)
  })
})

describe('body progress helpers', () => {
  it('flattens step ids in depth-first execution order', () => {
    expect(flattenStepIds([
      { id: 'a', kind: 'phase', label: 'Outer', children: [
        { id: 'a1', kind: 'agent', label: 'In', prompt: 'x' },
      ] },
      { id: 'b', kind: 'agent', label: 'Last', prompt: 'y' },
    ])).toEqual(['a', 'a1', 'b'])
  })

  it('names the first incomplete step and none when all are complete', () => {
    const state = foldRunMachine([
      event('duty/step', { stepId: 'a', label: 'A', status: 'completed', attempts: 1 }, 1),
    ])
    expect(nextIncompleteStepId(['a', 'b'], state)).toBe('b')

    const done = foldRunMachine([
      event('duty/step', { stepId: 'a', label: 'A', status: 'completed', attempts: 1 }, 1),
      event('duty/step', { stepId: 'b', label: 'B', status: 'completed', attempts: 1 }, 2),
    ])
    expect(nextIncompleteStepId(['a', 'b'], done)).toBeUndefined()
  })
})
