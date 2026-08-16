import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DutyError } from '../src/index.ts'
import type { DutyId, DutyRunCause } from '../src/types.ts'
import {
  createDutyHarness,
  createRequest,
  restartDutyHarness,
  sessionId,
  SIMPLE_BODY,
  type DutyHarness,
} from './helpers.ts'

const SCHEDULE: DutyRunCause = { kind: 'schedule', reason: 'the hourly trigger fired' }
const MANUAL: DutyRunCause = { kind: 'manual', reason: 'started by hand' }

describe('duty service', () => {
  let harness: DutyHarness

  beforeEach(async () => {
    harness = await createDutyHarness()
  })

  afterEach(async () => {
    await harness.dispose()
  })

  /** Activate a freshly created Duty so it may be claimed. */
  async function activeDuty(overrides = {}): Promise<DutyId> {
    const view = await harness.duties.create(createRequest(overrides))
    await harness.duties.setLifecycle(view.spec.id, 'active')
    return view.spec.id
  }

  describe('creation', () => {
    it('honors a caller-supplied uuid as the duty id', async () => {
      const view = await harness.duties.create(createRequest({
        id: '5f9c4c3e-2e0a-4f7b-9c1d-3f2e1d0c9b8a',
      }))
      expect(view.spec.id).toBe('5f9c4c3e-2e0a-4f7b-9c1d-3f2e1d0c9b8a')
    })

    it('rejects a second create with the same supplied id', async () => {
      const id = '5f9c4c3e-2e0a-4f7b-9c1d-3f2e1d0c9b8a'
      await harness.duties.create(createRequest({ id }))
      await expect(harness.duties.create(createRequest({ id }))).rejects.toMatchObject({
        code: 'duty-exists',
      })
    })

    it('rejects a supplied id that is not a uuid', async () => {
      await expect(harness.duties.create(createRequest({ id: 'not-a-uuid' }))).rejects.toMatchObject({
        code: 'invalid-contract',
      })
    })

    it('starts a duty in draft with no runs', async () => {
      const view = await harness.duties.create(createRequest())
      expect(view.state.lifecycle).toBe('draft')
      expect(view.state.runCount).toBe(0)
      expect(view.state.running).toBe(false)
      expect(view.state.consecutiveFailures).toBe(0)
    })

    it('derives standing mode from a waking trigger', async () => {
      const view = await harness.duties.create(createRequest())
      expect(view.spec.mode).toBe('standing')
    })

    it('derives once mode from a manual trigger', async () => {
      const view = await harness.duties.create(createRequest({
        trigger: { kind: 'manual', description: 'when asked' },
      }))
      expect(view.spec.mode).toBe('once')
    })

    it('accepts a named verifier id as the verification selector', async () => {
      const view = await harness.duties.create(createRequest({ verification: 'strict' }))
      expect(view.spec.verification).toBe('strict')
    })

    it('applies the configured failure default when the request omits it', async () => {
      const view = await harness.duties.create(createRequest())
      expect(view.spec.limits.maxConsecutiveFailures).toBe(3)
    })
  })

  describe('claiming a run', () => {
    it('refuses to claim a draft duty', async () => {
      const view = await harness.duties.create(createRequest())
      const claim = await harness.duties.claim(view.spec.id, sessionId('a'), SCHEDULE)
      expect(claim).toMatchObject({ claimed: false, reason: 'draft' })
    })

    it('claims an active duty and opens run number one', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      expect(claim.claimed).toBe(true)
      if (!claim.claimed) throw new Error('expected a claim')
      expect(claim.run.index).toBe(1)
      expect(claim.run.status).toBe('running')
      expect(claim.run.sessionId).toBe(sessionId('a'))
      expect(harness.duties.get(id)?.state.running).toBe(true)
    })

    it('refuses a second concurrent claim', async () => {
      const id = await activeDuty()
      await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      const second = await harness.duties.claim(id, sessionId('b'), SCHEDULE)
      expect(second).toMatchObject({ claimed: false, reason: 'running' })
    })

    it('serializes concurrent claims so only one run starts', async () => {
      const id = await activeDuty()
      const [first, second] = await Promise.all([
        harness.duties.claim(id, sessionId('a'), SCHEDULE),
        harness.duties.claim(id, sessionId('b'), SCHEDULE),
      ])
      expect([first.claimed, second.claimed].filter(Boolean)).toHaveLength(1)
      expect(harness.duties.runsOf(id)).toHaveLength(1)
    })

    it('refuses to claim a paused duty', async () => {
      const id = await activeDuty()
      await harness.duties.setLifecycle(id, 'paused', 'human')
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      expect(claim).toMatchObject({ claimed: false, reason: 'paused' })
    })

    it('numbers each successive run', async () => {
      const id = await activeDuty()
      const first = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!first.claimed) throw new Error('expected a claim')
      await harness.duties.settle(id, first.run.id, { status: 'succeeded' })
      const second = await harness.duties.claim(id, sessionId('b'), MANUAL)
      if (!second.claimed) throw new Error('expected a claim')
      expect(second.run.index).toBe(2)
    })
  })

  describe('settling a run', () => {
    it('advances the cursor only when the run succeeded', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const state = await harness.duties.settle(id, claim.run.id, {
        status: 'succeeded',
        cursor: { seq: 42 },
      })
      expect(state.cursor).toEqual({ seq: 42 })
    })

    it('leaves the cursor untouched when the run failed', async () => {
      const id = await activeDuty()
      const first = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!first.claimed) throw new Error('expected a claim')
      await harness.duties.settle(id, first.run.id, { status: 'succeeded', cursor: { seq: 7 } })
      const second = await harness.duties.claim(id, sessionId('b'), SCHEDULE)
      if (!second.claimed) throw new Error('expected a claim')
      const state = await harness.duties.settle(id, second.run.id, {
        status: 'failed',
        cursor: { seq: 99 },
      })
      expect(state.cursor).toEqual({ seq: 7 })
    })

    it('releases the run claim when the run settles', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const state = await harness.duties.settle(id, claim.run.id, { status: 'succeeded' })
      expect(state.running).toBe(false)
    })

    it('keeps the claim while the run waits for a human', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const state = await harness.duties.settle(id, claim.run.id, { status: 'waiting_for_human' })
      expect(state.running).toBe(true)
    })

    it('pauses the duty after the configured consecutive failures', async () => {
      const id = await activeDuty()
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const claim = await harness.duties.claim(id, sessionId(`a${attempt}`), SCHEDULE)
        if (!claim.claimed) throw new Error('expected a claim')
        await harness.duties.settle(id, claim.run.id, { status: 'failed' })
      }
      const view = harness.duties.get(id)
      expect(view?.state.lifecycle).toBe('paused')
      expect(view?.state.pausedReason).toBe('failures')
      expect(view?.state.consecutiveFailures).toBe(3)
    })

    it('resets the failure count on a success', async () => {
      const id = await activeDuty()
      const failed = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!failed.claimed) throw new Error('expected a claim')
      await harness.duties.settle(id, failed.run.id, { status: 'failed' })
      const passed = await harness.duties.claim(id, sessionId('b'), SCHEDULE)
      if (!passed.claimed) throw new Error('expected a claim')
      const state = await harness.duties.settle(id, passed.run.id, { status: 'succeeded' })
      expect(state.consecutiveFailures).toBe(0)
      expect(state.lifecycle).toBe('active')
    })

    it('pauses immediately for a budget overrun regardless of the failure count', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const state = await harness.duties.settle(id, claim.run.id, {
        status: 'failed',
        pause: 'budget',
      })
      expect(state.lifecycle).toBe('paused')
      expect(state.pausedReason).toBe('budget')
      expect(state.consecutiveFailures).toBe(1)
    })

    it('records the settled status and summary on the run', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      await harness.duties.settle(id, claim.run.id, {
        status: 'succeeded',
        summary: 'Triaged 4 tickets.',
        costUsd: 0.12,
      })
      const [run] = harness.duties.runsOf(id)
      expect(run?.status).toBe('succeeded')
      expect(run?.summary).toBe('Triaged 4 tickets.')
      expect(run?.costUsd).toBe(0.12)
      expect(run?.completedAt).toBeTypeOf('number')
    })
  })

  describe('human decisions', () => {
    it('opens a durable request that survives the asking process', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const request = await harness.duties.ask({
        dutyId: id,
        runId: claim.run.id,
        sessionId: sessionId('a'),
        reason: 'authorization',
        question: 'Send the reply to the customer?',
        options: ['send', 'hold'],
      })
      expect(request.status).toBe('open')
      expect(harness.duties.openRequests()).toHaveLength(1)
    })

    it('accepts one of the offered options', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const request = await harness.duties.ask({
        dutyId: id,
        runId: claim.run.id,
        sessionId: sessionId('a'),
        reason: 'choice',
        question: 'Which queue?',
        options: ['billing', 'support'],
      })
      const answered = await harness.duties.answer(id, request.id, 'billing')
      expect(answered.status).toBe('answered')
      expect(answered.answer).toBe('billing')
      expect(harness.duties.openRequests()).toHaveLength(0)
    })

    it('rejects an answer outside the offered options', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const request = await harness.duties.ask({
        dutyId: id,
        runId: claim.run.id,
        sessionId: sessionId('a'),
        reason: 'choice',
        question: 'Which queue?',
        options: ['billing', 'support'],
      })
      await expect(harness.duties.answer(id, request.id, 'legal')).rejects.toMatchObject({
        code: 'answer-not-offered',
      })
    })

    it('refuses to answer a settled request twice', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      const request = await harness.duties.ask({
        dutyId: id,
        runId: claim.run.id,
        sessionId: sessionId('a'),
        reason: 'missing_info',
        question: 'Which account?',
        allowFreeform: true,
      })
      await harness.duties.answer(id, request.id, 'account 7')
      await expect(harness.duties.answer(id, request.id, 'account 8')).rejects.toMatchObject({
        code: 'request-already-settled',
      })
    })
  })

  describe('editing under compare-and-set', () => {
    it('replaces named fields and mints a new version', async () => {
      const view = await harness.duties.create(createRequest())
      const edited = await harness.duties.edit(view.spec.id, view.spec.version, {
        title: 'Triage billing tickets',
      })
      expect(edited.spec.title).toBe('Triage billing tickets')
      expect(edited.spec.version).not.toBe(view.spec.version)
      expect(edited.spec.goal).toBe(view.spec.goal)
    })

    it('rejects an edit against a stale version', async () => {
      const view = await harness.duties.create(createRequest())
      await harness.duties.edit(view.spec.id, view.spec.version, { title: 'First' })
      await expect(
        harness.duties.edit(view.spec.id, view.spec.version, { title: 'Second' }),
      ).rejects.toBeInstanceOf(DutyError)
    })

    it('re-derives mode when the trigger changes', async () => {
      const view = await harness.duties.create(createRequest())
      const edited = await harness.duties.edit(view.spec.id, view.spec.version, {
        trigger: { kind: 'manual', description: 'when asked' },
      })
      expect(edited.spec.mode).toBe('once')
    })
  })

  describe('trigger audit', () => {
    it('records why a wakeup did not run', async () => {
      const id = await activeDuty()
      await harness.duties.setLifecycle(id, 'paused', 'human')
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (claim.claimed) throw new Error('expected no claim')
      await harness.duties.recordTrigger({
        dutyId: id,
        cause: SCHEDULE,
        matched: false,
        skippedReason: claim.reason,
      })
      const [event] = harness.duties.triggerEventsOf(id)
      expect(event?.matched).toBe(false)
      expect(event?.skippedReason).toBe('paused')
    })

    it('trims audit history to the configured retention', async () => {
      await harness.dispose()
      harness = await createDutyHarness({ triggerEventLimit: 2 })

      const id = await activeDuty()
      for (let index = 0; index < 4; index += 1) {
        await harness.duties.recordTrigger({
          dutyId: id,
          cause: SCHEDULE,
          matched: false,
          skippedReason: 'not-due',
        })
      }
      expect(harness.duties.triggerEventsOf(id)).toHaveLength(2)
    })
  })

  describe('durability', () => {
    it('serves a duty, its cursor, and its runs after the service restarts', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      await harness.duties.settle(id, claim.run.id, {
        status: 'succeeded',
        cursor: { seq: 3 },
        summary: 'Triaged 2 tickets.',
      })
      harness = await restartDutyHarness(harness)
      const view = harness.duties.get(id)
      expect(view?.spec.title).toBe('Triage tickets')
      expect(view?.state.cursor).toEqual({ seq: 3 })
      expect(view?.state.lifecycle).toBe('active')
      expect(view?.state.running).toBe(false)
      const [run] = harness.duties.runsOf(id)
      expect(run?.summary).toBe('Triaged 2 tickets.')
      expect(run?.index).toBe(1)
    })

    it('continues run numbering across a restart', async () => {
      const id = await activeDuty()
      const first = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!first.claimed) throw new Error('expected a claim')
      await harness.duties.settle(id, first.run.id, { status: 'succeeded' })
      harness = await restartDutyHarness(harness)
      const second = await harness.duties.claim(id, sessionId('b'), SCHEDULE)
      if (!second.claimed) throw new Error('expected a claim')
      expect(second.run.index).toBe(2)
    })

    it('keeps an unanswered human request open across a restart', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      await harness.duties.ask({
        dutyId: id,
        runId: claim.run.id,
        sessionId: sessionId('a'),
        reason: 'authorization',
        question: 'Send the reply?',
        options: ['send', 'hold'],
      })
      await harness.duties.settle(id, claim.run.id, { status: 'waiting_for_human' })
      harness = await restartDutyHarness(harness)
      const [open] = harness.duties.openRequests()
      expect(open?.question).toBe('Send the reply?')
      expect(harness.duties.get(id)?.state.running).toBe(true)
    })

    it('removes every record the duty owned', async () => {
      const id = await activeDuty()
      const claim = await harness.duties.claim(id, sessionId('a'), SCHEDULE)
      if (!claim.claimed) throw new Error('expected a claim')
      expect(await harness.duties.remove(id)).toBe(true)
      expect(harness.duties.get(id)).toBeUndefined()
      expect(harness.duties.runsOf(id)).toHaveLength(0)
    })
  })

  describe('contract validation', () => {
    it('derives once mode rather than storing a standing duty that cannot wake', async () => {
      const view = await harness.duties.create(createRequest({
        trigger: { kind: 'manual', description: 'when asked' },
      }))
      expect(view.spec.mode).toBe('once')
    })

    it('rejects an agent step without a prompt', async () => {
      await expect(harness.duties.create(createRequest({
        body: { steps: [{ id: 'x', kind: 'agent', label: 'No prompt' }] },
      }))).rejects.toMatchObject({ code: 'invalid-contract' })
    })

    it('rejects a parallel step wider than the fan-out limit', async () => {
      await expect(harness.duties.create(createRequest({
        body: {
          steps: [{
            id: 'wide',
            kind: 'parallel',
            label: 'Too wide',
            children: Array.from({ length: 9 }, (_unused, index) => ({
              id: `child-${index}`,
              kind: 'agent' as const,
              label: `Child ${index}`,
              prompt: 'work',
            })),
          }],
        },
      }))).rejects.toMatchObject({ code: 'invalid-contract' })
    })

    it('rejects a gated tool that is not also allowed', async () => {
      await expect(harness.duties.create(createRequest({
        toolPolicy: { allow: ['read'], gated: ['write'] },
      }))).rejects.toMatchObject({ code: 'invalid-contract' })
    })

    it('accepts a body at the nesting limit', async () => {
      const view = await harness.duties.create(createRequest({
        body: {
          steps: [{
            id: 'phase',
            kind: 'phase',
            label: 'Outer',
            children: SIMPLE_BODY.steps.map(step => ({ ...step })),
          }],
        },
      }))
      expect(view.spec.body.steps).toHaveLength(1)
    })
  })
})
