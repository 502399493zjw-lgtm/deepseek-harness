import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DutyId } from '@deepseek-ai/dsh-duty'
import type { DutyRunCause } from '@deepseek-ai/dsh-duty'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import DutyRunnerService from '../src/index.ts'
import { createDutyHarness, createRequest } from '../../duty/tests/helpers.ts'
import type { DutyHarness } from '../../duty/tests/helpers.ts'

/** A Session stand-in that records appended events like the real envelope. */
class FakeSession {
  readonly id: SessionId
  readonly events: SessionEvent[] = []
  private seq = 0

  constructor(id: SessionId) {
    this.id = id
  }

  append(type: string, data: object): void {
    this.events.push({ type, seq: this.seq += 1, time: Date.now(), data } as unknown as SessionEvent)
  }
}

/** A scripted agent: every followup runs the registered scripts before idle. */
class FakeAgent {
  readonly id: SessionId
  readonly session: FakeSession
  readonly runScripts: (text: string, agent: FakeAgent) => Promise<void>
  private pending: Promise<void> = Promise.resolve()

  constructor(
    id: SessionId,
    session: FakeSession,
    runScripts: (text: string, agent: FakeAgent) => Promise<void>,
  ) {
    this.id = id
    this.session = session
    this.runScripts = runScripts
  }

  followup(message: { content: readonly { type: string; text?: string }[] }): void {
    const text = message.content[0]?.type === 'text' ? (message.content[0].text ?? '') : ''
    this.pending = this.pending.then(() => this.runScripts(text, this))
  }

  whenIdle(): Promise<void> {
    return this.pending
  }
}

/** A minimal tools stand-in recording registrations and exposing them. */
class FakeTools {
  readonly tools = new Map<string, { execute(args: unknown): Promise<unknown> }>()
  readonly guards: ((exec: { name: string }) => string | undefined)[] = []
  restrictions: { allow?: readonly string[] }[] = []

  restrict(filter: { allow?: readonly string[] }): () => void {
    this.restrictions.push(filter)
    return () => {}
  }

  guard(guard: (exec: { name: string }) => string | undefined): () => void {
    this.guards.push(guard)
    return () => {}
  }

  register(tool: { name: string; execute(args: unknown): Promise<unknown> }): () => void {
    this.tools.set(tool.name, tool)
    return () => {
      this.tools.delete(tool.name)
    }
  }
}

/** One model-simulation script run for every followup of every run Agent. */
type FollowupScript = (text: string, agent: FakeAgent) => Promise<void> | void

/** Harness for the run runtime over a real duty domain and fake agents. */
async function createRunnerHarness(options: { withVerifiers?: boolean } = {}): Promise<{
  ctx: Context
  duty: DutyHarness
  tools: FakeTools
  scripts: Set<FollowupScript>
  sessions: Map<SessionId, FakeSession>
  setVerifier(fn: (request: unknown, verifierId?: string) => Promise<{ pass: boolean; reason?: string }>): void
  waitFor: (predicate: () => boolean) => Promise<void>
  dispose(): Promise<void>
}> {
  const duty = await createDutyHarness()
  const tools = new FakeTools()
  const scripts = new Set<FollowupScript>()
  const sessions = new Map<SessionId, FakeSession>()

  duty.ctx.provide('sessions', { flush: async () => true })
  duty.ctx.provide('sessionPersistence', {})
  let verifyStep = async (_request: unknown, _verifierId?: string) => ({ pass: true })
  if (options.withVerifiers !== false) {
    duty.ctx.provide('dutyVerifiers', {
      verify: async (request: unknown, verifierId?: string) => verifyStep(request, verifierId),
    })
  }
  duty.ctx.provide('agents', {
    create: async (options: { sessionId: SessionId; setup?: (agentCtx: Context) => void }) => {
      const session = new FakeSession(options.sessionId)
      sessions.set(options.sessionId, session)
      const agent = new FakeAgent(options.sessionId, session, async (text, current) => {
        for (const script of scripts) await script(text, current)
      })
      const agentCtx = new Context()
      agentCtx.provide('tools', tools)
      options.setup?.(agentCtx)
      return { agent, dispose: async () => {} }
    },
    resume: async (options: { resumeSessionId: SessionId; setup?: (agentCtx: Context) => void }) => {
      const session = sessions.get(options.resumeSessionId)
      if (session === undefined) throw new Error(`no fake session '${options.resumeSessionId}'`)
      const agent = new FakeAgent(options.resumeSessionId, session, async (text, current) => {
        for (const script of scripts) await script(text, current)
      })
      const agentCtx = new Context()
      agentCtx.provide('tools', tools)
      options.setup?.(agentCtx)
      return { agent, dispose: async () => {} }
    },
  })
  duty.ctx.provide('subagents', {
    start: async (_provider: string, _request: unknown) => ({
      result: Promise.resolve({ stopReason: 'completed', output: [] }),
      dispose: async () => {},
    }),
  })

  await duty.ctx.plugin(DutyRunnerService, {
    subagentProvider: 'fake',
    tokenPriceUsdPerMillion: 1,
    maxRepairs: 2,
  })

  const waitFor = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(predicate()).toBe(true)
  }

  return {
    ctx: duty.ctx,
    duty,
    tools,
    scripts,
    sessions,
    setVerifier: (fn: (request: unknown, verifierId?: string) => Promise<{ pass: boolean; reason?: string }>) => {
      verifyStep = fn
    },
    waitFor,
    dispose: async () => {
      await duty.dispose()
    },
  }
}

const SCHEDULE: DutyRunCause = { kind: 'schedule', reason: 'the hourly trigger fired' }

/** Simulate the model calling duty_step_done after each step instruction. */
function completeStepScript(stepId: string, summary = 'done'): FollowupScript {
  return async (text, _agent) => {
    if (text.includes('执行步骤') && text.includes('duty_step_done')) {
      await harness.tools.tools.get('duty_step_done')?.execute({ step_id: stepId, summary })
    }
  }
}

/** Harness captured by scripts; assigned before any script runs. */
let harness: Awaited<ReturnType<typeof createRunnerHarness>>

describe('duty run runtime', () => {
  beforeEach(async () => {
    harness = await createRunnerHarness()
  })

  afterEach(async () => {
    await harness.dispose()
  })

  /** Create and activate a single-step duty. */
  async function activeDuty(overrides = {}): Promise<{ dutyId: string; stepId: string }> {
    const request = createRequest(overrides)
    const view = await harness.duty.duties.create(request)
    await harness.duty.duties.setLifecycle(view.spec.id, 'active')
    return { dutyId: view.spec.id, stepId: request.body.steps[0]?.id ?? 'collect' }
  }

  const trigger = (dutyId: string): void => {
    harness.ctx.emit('duty/trigger', {
      dutyId: DutyId(dutyId),
      providerId: 'timer',
      cause: SCHEDULE,
      occurredAt: Date.now(),
    })
  }

  it('runs a triggered duty to success and settles the run', async () => {
    const { dutyId, stepId } = await activeDuty()
    harness.scripts.add(completeStepScript(stepId, 'triaged 3 tickets'))

    trigger(dutyId)

    await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'succeeded')
    const view = harness.duty.duties.get(DutyId(dutyId))
    expect(view?.state.lastOutcome).toBe('succeeded')
    expect(view?.state.cursor).toEqual({ lastStepId: stepId })
    const [run] = harness.duty.duties.runsOf(DutyId(dutyId))
    expect(run?.summary).toBe('triaged 3 tickets')
    expect(run?.status).toBe('succeeded')
    expect(run?.completedAt).toBeTypeOf('number')
  })

  it('records a skip when the duty is paused', async () => {
    const { dutyId } = await activeDuty()
    await harness.duty.duties.setLifecycle(DutyId(dutyId), 'paused', 'human')

    trigger(dutyId)

    await harness.waitFor(() =>
      harness.duty.duties.triggerEventsOf(DutyId(dutyId)).some(event => !event.matched))
    expect(harness.duty.duties.get(DutyId(dutyId))?.state.running).toBe(false)
  })

  it('repairs a step that never reports completion, then fails the run', async () => {
    const { dutyId } = await activeDuty()
    // No completion script: the step exhausts its three attempts.

    trigger(dutyId)

    await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'failed')
    const view = harness.duty.duties.get(DutyId(dutyId))
    expect(view?.state.lastOutcome).toBe('failed')
    const [run] = harness.duty.duties.runsOf(DutyId(dutyId))
    expect(run?.summary).toContain('did not complete after 3 attempts')
    expect(view?.state.consecutiveFailures).toBe(1)
  })

  it('parks on a human request and resumes the same session on the answer', async () => {
    const { dutyId, stepId } = await activeDuty()
    let asked = false
    harness.scripts.add(async (text) => {
      if (!asked && text.includes('执行步骤')) {
        asked = true
        await harness.tools.tools.get('duty_request_human')?.execute({
          question: 'Send the reply?',
          reason: 'authorization',
          options: ['send', 'hold'],
        })
        return
      }
      if (asked && text.includes('执行步骤') && text.includes('duty_step_done')) {
        await harness.tools.tools.get('duty_step_done')?.execute({ step_id: stepId, summary: 'sent' })
      }
    })

    trigger(dutyId)

    // The run parks: waiting_for_human with the claim held.
    await harness.waitFor(() =>
      harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'waiting_for_human')
    const parked = harness.duty.duties.get(DutyId(dutyId))
    expect(parked?.state.lastOutcome).toBe('waiting_for_human')
    expect(parked?.state.running).toBe(true)
    expect(harness.duty.duties.openRequests()).toHaveLength(1)

    const request = harness.duty.duties.openRequests()[0]
    if (request === undefined) throw new Error('expected an open human request')
    await harness.duty.duties.answer(DutyId(dutyId), request.id, 'send')

    await harness.waitFor(() =>
      harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'succeeded')
    const settled = harness.duty.duties.get(DutyId(dutyId))
    expect(settled?.state.running).toBe(false)
    const [run] = harness.duty.duties.runsOf(DutyId(dutyId))
    expect(run?.status).toBe('succeeded')
    expect(run?.summary).toBe('sent')
  })

  it('starts a run by hand and rejects an unrunnable duty', async () => {
    const { dutyId, stepId } = await activeDuty()
    harness.scripts.add(completeStepScript(stepId))

    const run = await harness.ctx.dutyRunner.startRun(
      DutyId(dutyId),
      { kind: 'manual', reason: 'asked by hand' },
    )
    expect(run.status).toBe('running')
    expect(run.cause.kind).toBe('manual')

    await harness.waitFor(() =>
      harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'succeeded')

    // A paused duty refuses a manual start with a stable error code.
    await harness.duty.duties.setLifecycle(DutyId(dutyId), 'paused', 'human')
    await expect(
      harness.ctx.dutyRunner.startRun(DutyId(dutyId), { kind: 'manual', reason: 'again' }),
    ).rejects.toMatchObject({ code: 'duty-not-runnable' })
  })

  it('pauses on a budget overrun even on the first run', async () => {
    const { dutyId, stepId } = await activeDuty({ limits: { budgetUsd: 0.000001 } })
    harness.scripts.add(completeStepScript(stepId))
    harness.scripts.add(async (text, agent) => {
      if (text.includes('开始执行')) {
        // Attribute 10 tokens to the run: 10 × 1 USD/1M = 0.00001 USD.
        agent.session.events.push({
          type: 'assistant/message',
          seq: 100,
          time: Date.now(),
          data: { message: {}, usage: { inputTokens: 5, outputTokens: 5 } },
        } as unknown as SessionEvent)
      }
    })

    trigger(dutyId)

    await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lifecycle === 'paused')
    const view = harness.duty.duties.get(DutyId(dutyId))
    expect(view?.state.lifecycle).toBe('paused')
    expect(view?.state.pausedReason).toBe('budget')
    expect(view?.state.lastOutcome).toBe('failed')
    const [run] = harness.duty.duties.runsOf(DutyId(dutyId))
    expect(run?.costUsd).toBeCloseTo(0.00001)
  })

  describe('independent verification', () => {
    it('passes a named verifier id through to the registry', async () => {
      const seenIds: Array<string | undefined> = []
      harness.setVerifier(async (_request, verifierId) => {
        seenIds.push(verifierId)
        return { pass: true }
      })
      const { dutyId, stepId } = await activeDuty({ verification: 'custom-verifier' })
      harness.scripts.add(completeStepScript(stepId))

      trigger(dutyId)

      await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'succeeded')
      expect(seenIds).toEqual(['custom-verifier'])
    })

    it('passes no id for verification on, selecting the configured default', async () => {
      const seenIds: Array<string | undefined> = []
      harness.setVerifier(async (_request, verifierId) => {
        seenIds.push(verifierId)
        return { pass: true }
      })
      const { dutyId, stepId } = await activeDuty({ verification: 'on' })
      harness.scripts.add(completeStepScript(stepId))

      trigger(dutyId)

      await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'succeeded')
      expect(seenIds).toEqual([undefined])
    })
    const verifySequence = (verdicts: Array<{ pass: boolean; reason?: string }>) => {
      let index = 0
      harness.setVerifier(async () => {
        const verdict = verdicts[Math.min(index, verdicts.length - 1)]
        index += 1
        return verdict ?? { pass: true }
      })
    }

    it('records a passing verdict and completes the step', async () => {
      const { dutyId, stepId } = await activeDuty({ verification: 'on' })
      verifySequence([{ pass: true }])
      harness.scripts.add(completeStepScript(stepId, 'triaged 3 tickets'))

      trigger(dutyId)

      await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'succeeded')
      const sessionsWithVerdict = [...harness.sessions.values()].filter(session =>
        session.events.some((event: SessionEvent) => event.type === 'duty/verdict'))
      expect(sessionsWithVerdict.length).toBe(1)
      const [verdict] = sessionsWithVerdict[0]?.events.filter((event: SessionEvent) => event.type === 'duty/verdict') ?? []
      expect((verdict?.data as { pass: boolean }).pass).toBe(true)
    })

    it('sends a failed verdict back through repair, then passes', async () => {
      const { dutyId, stepId } = await activeDuty({ verification: 'on' })
      verifySequence([{ pass: false, reason: 'no proof' }, { pass: true }])
      harness.scripts.add(completeStepScript(stepId))

      trigger(dutyId)

      await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'succeeded')
      const view = harness.duty.duties.get(DutyId(dutyId))
      const completed = [...harness.sessions.values()].flatMap(session =>
        session.events.filter((event: SessionEvent) => event.type === 'duty/step' && (event.data as { status: string }).status === 'completed'))
      expect(completed[0]?.data).toMatchObject({ attempts: 2 })
      expect(view?.state.cursor).toEqual({ lastStepId: stepId })
    })

    it('fails the run when every verdict fails', async () => {
      const { dutyId } = await activeDuty({ verification: 'on' })
      verifySequence([{ pass: false, reason: 'no proof' }])
      harness.scripts.add(completeStepScript('collect'))

      trigger(dutyId)

      await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'failed')
      const view = harness.duty.duties.get(DutyId(dutyId))
      expect(view?.state.consecutiveFailures).toBe(1)
    })

    it('fails loud when verification is on but no registry is loaded', async () => {
      await harness.dispose()
      harness = await createRunnerHarness({ withVerifiers: false })
      const { dutyId } = await activeDuty({ verification: 'on' })
      harness.scripts.add(completeStepScript('collect'))

      trigger(dutyId)

      await harness.waitFor(() => harness.duty.duties.get(DutyId(dutyId))?.state.lastOutcome === 'failed')
      const [run] = harness.duty.duties.runsOf(DutyId(dutyId))
      expect(run?.summary).toContain('no duty verifier registry is loaded')
    })
  })

  it('narrows the run agent to the tool allowance and gates gated tools', async () => {
    const { dutyId } = await activeDuty({ toolPolicy: { allow: ['read'], gated: ['read'] } })

    trigger(dutyId)

    await harness.waitFor(() => harness.tools.restrictions.length > 0)
    expect(harness.tools.restrictions[0]).toEqual({ allow: ['read'] })
    await harness.waitFor(() => harness.tools.guards.length > 0)
    const guard = harness.tools.guards[0]
    if (guard === undefined) throw new Error('expected a gated-tool guard')
    expect(guard({ name: 'read' })).toContain('gated')
    expect(guard({ name: 'other' })).toBeUndefined()
  })
})
