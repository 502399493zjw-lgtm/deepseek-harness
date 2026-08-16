/**
 * The Duty run runtime: turns a waking observation or manual start into one
 * major-trigger run, drives the stored execution body as agent turns and
 * subagent fan-out, parks on durable human decisions, and settles the run
 * under the Duty's failure, budget, and cursor policy.
 *
 * The run's Session log is the machine's only authority: every state change is
 * a session event, and a parked run resumes by refolding the persisted log
 * after the human answers — including across a process restart.
 * @module @deepseek-ai/dsh-duty-runner
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  DutyError,
  dutyBodySchema,
} from '@deepseek-ai/dsh-duty'
import type {
  DutyBody,
  DutyId,
  DutyRun,
  DutyRunCause,
  DutyRunId,
  DutySpec,
  DutyStep,
  HumanRequest,
} from '@deepseek-ai/dsh-duty'
import type { DutyTriggerObservation } from '@deepseek-ai/dsh-duty-trigger'
import './session-events.ts'
import { flattenStepIds, foldRunMachine, nextIncompleteStepId } from './machine.ts'
import {
  applyDutyRunProjection,
  DUTY_RUN_PROJECTION_VERSION,
  dutyRunProjectionSchema,
} from './projection.ts'
import type { DutyRunMachineState } from './types.ts'

export type * from './types.ts'
export { flattenStepIds, foldRunMachine, nextIncompleteStepId } from './machine.ts'
export type { DutyMessageSource } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dutyRunner: DutyRunnerService
  }
}

/** Deployment policy for run driving, pricing, and repair. */
export interface Config {
  /** Subagent provider used for `parallel` fan-out. */
  readonly subagentProvider: string
  /**
   * Blended USD price per million tokens used to attribute cost to a run;
   * zero disables cost accounting (a Duty with a budget then never pauses on
   * it).
   */
  readonly tokenPriceUsdPerMillion: number
  /** Repairs per agent step after the first attempt, 0–5. */
  readonly maxRepairs: number
}

/** Render an unknown failure for process-local diagnostics only. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** The optional host default-model service, read at admission time. */
interface DefaultModelLike {
  currentSelection(): { provider: string; model: string }
}

/**
 * The Chinese kickoff naming the trigger cause, kept verbatim from the loop
 * flow convention: the first model-visible line of every run explains why the
 * run exists.
 * @param reason - The trigger cause's human-readable statement.
 * @returns the kickoff text.
 */
function renderKickoff(reason: string): string {
  return `开始执行你的 loop flow。本次触发原因:${reason}。`
}

/** One step instruction with the completion-marking contract. */
function renderStepInstruction(step: DutyStep, attempt: number): string {
  const retry = attempt > 1 ? `(第 ${attempt} 次尝试;上一次未报告完成,请先检查已有进展再继续。)` : ''
  return [
    `执行步骤「${step.label}」:${step.prompt ?? ''}`,
    '完成后必须调用 duty_step_done 报告一行摘要。',
    retry,
  ].filter(line => line.length > 0).join('\n')
}

/** One human-answer continuation prompt. */
function renderResume(answer: string): string {
  return `人类已答复:${answer}。继续执行当前步骤,完成后调用 duty_step_done。`
}

/** Per-run process-local working set; never authoritative across a restart. */
interface RunLocal {
  readonly run: DutyRun
  readonly spec: DutySpec
  readonly summaries: Map<string, string>
  readonly failures: string[]
  /** Cancellation channel for this run's fan-out children. */
  readonly controller: AbortController
  /** The live run Session once its Agent exists; the scoped tools append here. */
  session?: Session
  /** The body adapted by the run's agent through `duty_adapt_body`. */
  adaptedBody?: DutyBody
  /** Set once the run asked a human; the machine parks at the next idle. */
  parkedRequestId: string | undefined
}

/** The most recent recorded failure, for settling the run. */
function lastFailure(local: RunLocal): string {
  return local.failures[local.failures.length - 1] ?? 'the run failed'
}

/** Find one step by body-local id. */
function findStep(steps: readonly DutyStep[], id: string): DutyStep | undefined {
  for (const step of steps) {
    if (step.id === id) return step
    const nested = step.children === undefined ? undefined : findStep(step.children, id)
    if (nested !== undefined) return nested
  }
  return undefined
}

/** Validate one model-supplied adapted body at the tool boundary. */
function parseAdaptedBody(input: unknown): DutyBody {
  const result = dutyBodySchema.safeParse(input)
  if (!result.success) {
    const detail = result.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`adapted body is not storable: ${detail}`)
  }
  return result.data
}

/**
 * Runtime that turns observations into runs and drives each run's Session to
 * a terminal outcome. One claim from `ctx.duties` admits exactly one run;
 * everything after the claim is this service's own machine.
 */
export class DutyRunnerService extends Service {
  static inject = ['duties', 'agents', 'sessions', 'subagents', 'sessionPersistence']

  /** Loader validation for the run-driving policy. */
  static Config: s<Config> = s.object({
    subagentProvider: s.string().default('fork'),
    tokenPriceUsdPerMillion: s.number().min(0).required(),
    maxRepairs: s.number().step(1).min(0).max(5).default(2),
  })

  private readonly policy: Config
  private readonly locals = new Map<DutyRunId, RunLocal>()
  private readonly handles = new Map<DutyRunId, AgentHandle>()
  private readonly flights = new Set<Promise<void>>()
  private admissionOpen = true

  /**
   * Compose the run runtime and adopt its policy.
   * @param ctx - Cordis context carrying the Duty domain, agents, sessions,
   * subagents, and session persistence.
   * @param config - Validated driving policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'dutyRunner')
    this.policy = config
  }

  /** Subscribe to observations and answers, then reconcile interrupted runs. */
  protected async [Service.init](): Promise<void> {
    this.ctx.effect(() => async () => {
      // Close admission first, then drain: in-flight runs settle against the
      // still-open duty domain before this service's fiber finishes unloading.
      this.admissionOpen = false
      await Promise.allSettled([...this.flights])
    })
    this.ctx.on('duty/trigger', (observation: DutyTriggerObservation) => {
      if (!this.admissionOpen) return
      void this.handleObservation(observation)
    })
    this.ctx.on('duty/human-answered', (request: HumanRequest) => {
      if (!this.admissionOpen) return
      void this.handleAnswer(request)
    })
    // The `duty` projection unit: live run state for clients over any run's
    // Session. Optional — headless assemblies without a projection registry
    // stay unaffected.
    this.ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'duty', DutyRunMachineState | undefined>({
        key: 'duty',
        schema: dutyRunProjectionSchema as unknown as z.ZodType<DutyRunMachineState | undefined>,
        init: () => undefined,
        apply: applyDutyRunProjection,
        view: state => state,
        stateVersion: DUTY_RUN_PROJECTION_VERSION,
      })
    })
    await this.reconcileInterruptedRuns()
  }

  /**
   * Start one run by hand, bypassing the trigger seam.
   * @param dutyId - The Duty to run.
   * @param cause - Why a human or model asked for this run.
   * @param options - `wait` resolves only after the run settles, so a
   * foreground caller observes the outcome rather than just the admission.
   * @returns the started run.
   */
  async startRun(dutyId: DutyId, cause: DutyRunCause, options: { readonly wait?: boolean } = {}): Promise<DutyRun> {
    const view = this.ctx.duties.get(dutyId)
    if (view === undefined) throw new DutyError('duty-not-found', `no duty '${dutyId}'`)
    const sessionId = SessionId(randomUUID())
    const claim = await this.ctx.duties.claim(dutyId, sessionId, cause)
    if (!claim.claimed) {
      await this.ctx.duties.recordTrigger({
        dutyId,
        cause,
        matched: false,
        skippedReason: claim.reason,
      })
      throw new DutyError('duty-not-runnable', `duty '${dutyId}' cannot run: ${claim.reason}`)
    }
    await this.ctx.duties.recordTrigger({ dutyId, cause, matched: true, runId: claim.run.id })
    // Manual starts await admission: when this resolves the run's Session and
    // Agent exist and the kickoff is queued, so a caller that goes idle
    // immediately afterwards does not race the run's first model request.
    if (options.wait === true) {
      await this.admitRunAndSettle(claim.run, view.spec)
      return claim.run
    }
    await this.admitRun(claim.run, view.spec)
    return claim.run
  }

  /** Track one launched run so teardown can drain it before unloading. */
  private track(flight: Promise<void>): void {
    this.flights.add(flight)
    void flight.finally(() => {
      this.flights.delete(flight)
    })
  }

  /** One observation from the trigger seam: dedupe by claim, record, launch. */
  private async handleObservation(observation: DutyTriggerObservation): Promise<void> {
    const view = this.ctx.duties.get(observation.dutyId)
    if (view === undefined) return
    const sessionId = SessionId(randomUUID())
    const claim = await this.ctx.duties.claim(observation.dutyId, sessionId, observation.cause)
    if (!claim.claimed) {
      await this.ctx.duties.recordTrigger({
        dutyId: observation.dutyId,
        cause: observation.cause,
        matched: false,
        skippedReason: claim.reason,
      })
      return
    }
    await this.ctx.duties.recordTrigger({
      dutyId: observation.dutyId,
      cause: observation.cause,
      matched: true,
      runId: claim.run.id,
    })
    if (observation.nextWakeAt !== undefined) {
      await this.ctx.duties.setNextWake(observation.dutyId, observation.nextWakeAt)
    }
    this.trackRun(claim.run, view.spec)
  }

  /** Track one launched run so teardown can drain it before unloading. */
  private trackRun(run: DutyRun, spec: DutySpec): void {
    this.track(this.launchRun(run, spec))
  }

  /** Create the run's Session and Agent, queue the kickoff, and drive it. */
  private async launchRun(run: DutyRun, spec: DutySpec): Promise<void> {
    const local = this.makeLocal(run, spec)
    this.locals.set(run.id, local)
    try {
      const handle = await this.admit(run, spec, local)
      await this.driveRun(handle.agent, local)
    } catch (error: unknown) {
      if (this.admissionOpen) await this.failRun(local, renderThrown(error))
      else this.ctx.logger.warn(
        `duty-runner: run '${run.id}' failed during teardown: ${renderThrown(error)}`,
      )
    }
  }

  /** One run's process-local working set. */
  private makeLocal(run: DutyRun, spec: DutySpec): RunLocal {
    return {
      run,
      spec,
      summaries: new Map(),
      failures: [],
      controller: new AbortController(),
      parkedRequestId: undefined,
    }
  }

  /**
   * Admit one run: create its Session and Agent, bind the run identity, and
   * queue the kickoff. Resolves once the run is admitted and visible.
   * @param run - the claimed run.
   * @param spec - the stored contract.
   * @param local - the run's working set.
   * @returns the live run Agent handle.
   */
  /**
   * Resolve the run Agent's model selection from the host default-model
   * service. A host without that service leaves the loop's own resolution.
   * @returns the per-agent options to pass at creation, when resolvable.
   */
  private resolveAgentOptions(): { provider: string; model: string } | undefined {
    const defaults = this.ctx.get('agentDefaultModel') as unknown as DefaultModelLike | undefined
    const selection = defaults?.currentSelection()
    if (selection === undefined) return undefined
    return { provider: selection.provider, model: selection.model }
  }

  private async admit(run: DutyRun, spec: DutySpec, local: RunLocal): Promise<AgentHandle> {
    const agentOptions = this.resolveAgentOptions()
    const handle = await this.ctx.agents.create({
      sessionId: run.sessionId,
      ...(agentOptions === undefined ? {} : { agentOptions }),
      setup: (agentCtx) => {
        this.composeWorld(agentCtx, local)
      },
    })
    this.handles.set(run.id, handle)
    local.session = handle.agent.session
    handle.agent.session.append('duty/run-bound', {
      dutyId: spec.id,
      runId: run.id,
      cause: run.cause,
    })
    const kickoff = createUserMessage({
      content: [{ type: 'text', text: renderKickoff(run.cause.reason) }],
      source: { kind: 'duty' },
    })
    handle.agent.followup(kickoff)
    return handle
  }

  /** Admit one run through the startRun entry and drive it afterwards. */
  private async admitRun(run: DutyRun, spec: DutySpec): Promise<void> {
    const local = this.makeLocal(run, spec)
    this.locals.set(run.id, local)
    const handle = await this.admit(run, spec, local)
    this.track(this.driveRunGuarded(handle.agent, local))
  }

  /** Admit one run and await its settlement for a foreground caller. */
  private async admitRunAndSettle(run: DutyRun, spec: DutySpec): Promise<void> {
    const local = this.makeLocal(run, spec)
    this.locals.set(run.id, local)
    const handle = await this.admit(run, spec, local)
    await this.driveRunGuarded(handle.agent, local)
  }

  /** Drive one admitted run, settling a failure instead of rejecting. */
  private async driveRunGuarded(agent: Agent, local: RunLocal): Promise<void> {
    try {
      await this.driveRun(agent, local)
    } catch (error: unknown) {
      if (this.admissionOpen) await this.failRun(local, renderThrown(error))
      else this.ctx.logger.warn(
        `duty-runner: run '${local.run.id}' failed during teardown: ${renderThrown(error)}`,
      )
    }
  }

  /**
   * Compose the run Agent's scoped world: narrow tools to the allowance,
   * gate the gated ones, and register the run's three scoped tools.
   * @param agentCtx - The unpublished Agent scope.
   * @param local - The run's working set the tools close over.
   */
  private composeWorld(agentCtx: Context, local: RunLocal): void {
    const spec = local.spec
    agentCtx.tools.restrict({ allow: spec.toolPolicy.allow })
    const gated = new Set(spec.toolPolicy.gated)
    agentCtx.tools.guard((exec) => {
      if (!gated.has(exec.name)) return undefined
      return `tool '${exec.name}' is gated for this duty: call duty_request_human before retrying`
    })

    agentCtx.tools.register(defineTool({
      name: 'duty_adapt_body',
      description:
        'Record an adapted execution body for this run. Call it when the stored plan needs '
        + 'structural changes (different steps or ordering) before execution. The Host validates '
        + 'the body; use duty_step_done for progress, never for adaptation.',
      parameters: {
        body: { type: 'json', required: true, description: 'The complete adapted execution body.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args: { body: unknown }): Promise<{ ok: true; steps: number }> => {
        const body = parseAdaptedBody(args.body)
        local.adaptedBody = body
        return Promise.resolve({ ok: true, steps: flattenStepIds(body.steps).length })
      },
    }))

    agentCtx.tools.register(defineTool({
      name: 'duty_step_done',
      description:
        'Report that the current execution step completed, with a one-line summary. '
        + 'The run cannot advance to its next step until you call this.',
      parameters: {
        step_id: { type: 'string', required: true, description: 'The completed step id from the plan.' },
        summary: { type: 'string', required: true, description: 'One line describing what was done.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: (args: { step_id: string; summary: string }): Promise<{ ok: true; stepId: string }> => {
        const body = local.adaptedBody ?? spec.body
        if (findStep(body.steps, args.step_id) === undefined) {
          throw new Error(`unknown step id '${args.step_id}' for this duty`)
        }
        local.summaries.set(args.step_id, args.summary)
        return Promise.resolve({ ok: true, stepId: args.step_id })
      },
    }))

    agentCtx.tools.register(defineTool({
      name: 'duty_request_human',
      description:
        'Park the run and ask the human a durable question. Use it when you need an answer '
        + 'the duty contract forbids you from deciding. The run resumes in this same Session '
        + 'once the human answers.',
      parameters: {
        question: { type: 'string', required: true, description: 'The question to present.' },
        reason: {
          type: 'string',
          required: true,
          description: 'Why a human is needed: missing_info, authorization, choice, or blocked.',
        },
        options: { type: 'array', items: { type: 'string' }, description: 'Offered answers; omit for free-form.' },
        allow_freeform: { type: 'boolean', description: 'Whether answers outside options are accepted.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args: unknown) => {
        if (local.parkedRequestId !== undefined) {
          throw new Error('this run already has an open human request')
        }
        const { question, reason, options, allow_freeform: allowFreeform } = args as {
          question: string
          reason: HumanRequest['reason']
          options?: string[]
          allow_freeform?: boolean
        }
        const request = await this.ctx.duties.ask({
          dutyId: local.run.dutyId,
          runId: local.run.id,
          sessionId: local.run.sessionId,
          reason,
          question,
          ...(options === undefined ? {} : { options }),
          ...(allowFreeform === undefined ? {} : { allowFreeform }),
        })
        local.parkedRequestId = request.id
        // The durable wait is also a session event, so a cold fold recovers it.
        local.session?.append('duty/human-wait', { requestId: request.id, question })
        return { ok: true, requestId: request.id }
      },
    }))
  }

  /**
   * Drive one run's Session to a terminal outcome: fold the machine, work the
   * next incomplete step, and stop at finish, park, or failure.
   * @param agent - The live run Agent.
   * @param local - The run's working set.
   */
  private async driveRun(agent: Agent, local: RunLocal): Promise<void> {
    while (true) {
      const state = foldRunMachine(agent.session.events)
      if (state.finished !== undefined) return
      if (state.waitingHuman !== undefined) {
        await this.parkRun(agent, local)
        return
      }
      const body = local.adaptedBody ?? local.spec.body
      const nextId = nextIncompleteStepId(flattenStepIds(body.steps), state)
      if (nextId === undefined) {
        await this.finishRun(agent, local, state)
        return
      }
      const step = findStep(body.steps, nextId)
      if (step === undefined) {
        local.failures.push(`machine wants unknown step '${nextId}'`)
        await this.failRun(local, lastFailure(local))
        return
      }
      await this.executeStep(agent, local, step)
      if (local.parkedRequestId !== undefined) {
        await this.parkRun(agent, local)
        return
      }
      if (local.failures.length > 0) {
        await this.failRun(local, lastFailure(local))
        return
      }
    }
  }

  /** Execute one step: agent turns with repair, phase recursion, or fan-out. */
  private async executeStep(agent: Agent, local: RunLocal, step: DutyStep): Promise<void> {
    agent.session.append('duty/step', {
      stepId: step.id,
      label: step.label,
      status: 'started',
      attempts: 1,
    })
    if (step.kind === 'agent') {
      await this.executeAgentStep(agent, local, step)
      return
    }
    if (step.kind === 'parallel') {
      await this.executeParallelStep(agent, local, step)
      return
    }
    for (const child of step.children ?? []) {
      await this.executeStep(agent, local, child)
      if (local.parkedRequestId !== undefined || local.failures.length > 0) return
    }
    agent.session.append('duty/step', {
      stepId: step.id,
      label: step.label,
      status: 'completed',
      attempts: 1,
    })
  }

  /** One agent step with its repair loop over the completion-marking contract. */
  private async executeAgentStep(agent: Agent, local: RunLocal, step: DutyStep): Promise<void> {
    const maxAttempts = this.policy.maxRepairs + 1
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (attempt > 1) {
        agent.session.append('duty/step', {
          stepId: step.id,
          label: step.label,
          status: 'started',
          attempts: attempt,
        })
      }
      const instruction = createUserMessage({
        content: [{ type: 'text', text: renderStepInstruction(step, attempt) }],
        source: { kind: 'duty' },
      })
      agent.followup(instruction)
      await agent.whenIdle()
      if (local.parkedRequestId !== undefined) return
      const summary = local.summaries.get(step.id)
      if (summary !== undefined) {
        agent.session.append('duty/step', {
          stepId: step.id,
          label: step.label,
          status: 'completed',
          attempts: attempt,
          summary,
        })
        return
      }
    }
    agent.session.append('duty/step', {
      stepId: step.id,
      label: step.label,
      status: 'failed',
      attempts: maxAttempts,
    })
    local.failures.push(`step '${step.id}' (${step.label}) did not complete after ${maxAttempts} attempts`)
  }

  /** Fan a parallel step's children out through the subagent seam. */
  private async executeParallelStep(agent: Agent, local: RunLocal, step: DutyStep): Promise<void> {
    const children = step.children ?? []
    for (let attempt = 1; attempt <= this.policy.maxRepairs + 1; attempt += 1) {
      if (attempt > 1) {
        agent.session.append('duty/step', {
          stepId: step.id,
          label: step.label,
          status: 'started',
          attempts: attempt,
        })
      }
      const runs = await Promise.all(children.map(child =>
        this.ctx.subagents.start(this.policy.subagentProvider, {
          parent: agent,
          label: `${step.label} / ${child.label}`,
          prompt: [{ type: 'text', text: child.prompt ?? '' }],
          signal: local.controller.signal,
        })))
      const results = await Promise.all(runs.map(run => run.result))
      await Promise.all(runs.map(run => run.dispose()))
      const allCompleted = results.every(result => result.stopReason === 'completed')
      if (allCompleted) {
        agent.session.append('duty/step', {
          stepId: step.id,
          label: step.label,
          status: 'completed',
          attempts: attempt,
          summary: `${children.length} child runs completed`,
        })
        return
      }
    }
    agent.session.append('duty/step', {
      stepId: step.id,
      label: step.label,
      status: 'failed',
      attempts: this.policy.maxRepairs + 1,
    })
    local.failures.push(`parallel step '${step.id}' (${step.label}) did not complete`)
  }

  /** Park the run on its open human request: durable settle, then release. */
  private async parkRun(agent: Agent, local: RunLocal): Promise<void> {
    const state = foldRunMachine(agent.session.events)
    if (state.waitingHuman === undefined) return
    local.parkedRequestId = state.waitingHuman.requestId
    agent.session.append('duty/run-finish', { status: 'waiting_for_human' })
    await this.ctx.sessions.flush(agent.session)
    await this.ctx.duties.settle(local.run.dutyId, local.run.id, {
      status: 'waiting_for_human',
      ...(local.adaptedBody === undefined ? {} : { adapted: true }),
    })
    await this.releaseHandle(local.run.id)
  }

  /** Fold cost, apply the budget, then settle a completed run. */
  private async finishRun(agent: Agent, local: RunLocal, state: DutyRunMachineState): Promise<void> {
    const lastCompleted = state.steps.filter(step => step.status === 'completed').at(-1)
    const summary = lastCompleted?.summary ?? 'completed'
    const costUsd = this.foldCostUsd(agent.session)
    const budgetUsd = local.spec.limits.budgetUsd
    agent.session.append('duty/run-finish', { status: 'succeeded', summary })
    await this.ctx.sessions.flush(agent.session)
    if (budgetUsd !== undefined && this.policy.tokenPriceUsdPerMillion > 0 && costUsd > budgetUsd) {
      await this.ctx.duties.settle(local.run.dutyId, local.run.id, {
        status: 'failed',
        summary: `budget exceeded: ${costUsd.toFixed(2)} USD over ${budgetUsd} USD`,
        costUsd,
        adapted: local.adaptedBody !== undefined,
        pause: 'budget',
      })
      await this.releaseHandle(local.run.id)
      this.locals.delete(local.run.id)
      return
    }
    await this.ctx.duties.settle(local.run.dutyId, local.run.id, {
      status: 'succeeded',
      summary,
      costUsd,
      ...(lastCompleted === undefined ? {} : { cursor: { lastStepId: lastCompleted.stepId } }),
      ...(local.adaptedBody === undefined ? {} : { adapted: true }),
    })
    await this.releaseHandle(local.run.id)
    this.locals.delete(local.run.id)
  }

  /** Settle a failed run with its failure summary. */
  private async failRun(local: RunLocal, summary: string): Promise<void> {
    const handle = this.handles.get(local.run.id)
    if (handle !== undefined) {
      try {
        handle.agent.session.append('duty/run-finish', { status: 'failed', summary })
        await this.ctx.sessions.flush(handle.agent.session)
      } catch (error: unknown) {
        this.ctx.logger.warn(`duty-runner: could not record failure for run '${local.run.id}': ${renderThrown(error)}`)
      }
    }
    await this.ctx.duties.settle(local.run.dutyId, local.run.id, {
      status: 'failed',
      summary,
      ...(local.adaptedBody === undefined ? {} : { adapted: true }),
    })
    await this.releaseHandle(local.run.id)
    this.locals.delete(local.run.id)
  }

  /** Resume the Session a parked run's answered request belongs to. */
  private async handleAnswer(request: HumanRequest): Promise<void> {
    let target: RunLocal | undefined
    for (const local of this.locals.values()) {
      if (local.run.id === request.runId) target = local
    }
    if (target === undefined) return
    target.parkedRequestId = undefined
    try {
      const agentOptions = this.resolveAgentOptions()
      const handle = await this.ctx.agents.resume({
        resumeSessionId: request.sessionId,
        ...(agentOptions === undefined ? {} : { agentOptions }),
        setup: (agentCtx) => {
          this.composeWorld(agentCtx, target)
        },
      })
      this.handles.set(target.run.id, handle)
      target.session = handle.agent.session
      handle.agent.session.append('duty/human-answer', {
        requestId: request.id,
        answer: request.answer ?? '',
      })
      const resume = createUserMessage({
        content: [{ type: 'text', text: renderResume(request.answer ?? '') }],
        source: { kind: 'duty' },
      })
      handle.agent.followup(resume)
      await this.driveRun(handle.agent, target)
    } catch (error: unknown) {
      await this.failRun(target, renderThrown(error))
    }
  }

  /** Re-arm parked runs and cold-resume interrupted ones after a restart. */
  private async reconcileInterruptedRuns(): Promise<void> {
    for (const view of this.ctx.duties.list()) {
      if (!view.state.running) continue
      const run = this.ctx.duties.runsOf(view.spec.id).find(record => record.id === view.state.lastRunId)
      if (run === undefined) continue
      const open = this.ctx.duties.requestsOf(view.spec.id)
        .find(request => request.runId === run.id && request.status === 'open')
      const local: RunLocal = {
        run,
        spec: view.spec,
        summaries: new Map(),
        failures: [],
        controller: new AbortController(),
        parkedRequestId: open?.id,
      }
      this.locals.set(run.id, local)
      if (open !== undefined) continue
      try {
        const agentOptions = this.resolveAgentOptions()
        const handle = await this.ctx.agents.resume({
          resumeSessionId: run.sessionId,
          ...(agentOptions === undefined ? {} : { agentOptions }),
          setup: (agentCtx) => {
            this.composeWorld(agentCtx, local)
          },
        })
        this.handles.set(run.id, handle)
        local.session = handle.agent.session
        this.track(this.driveRun(handle.agent, local))
      } catch (error: unknown) {
        this.ctx.logger.warn(
          `duty-runner: could not resume interrupted run '${run.id}': ${renderThrown(error)}`,
        )
        await this.failRun(local, `run interrupted by a restart and could not resume: ${renderThrown(error)}`)
      }
    }
  }

  /** Sum one run's token usage and price it under the configured rate. */
  private foldCostUsd(session: Session): number {
    let tokens = 0
    for (const event of session.events) {
      if (event.type !== 'assistant/message') continue
      const usage = event.data.usage
      if (usage == null) continue
      tokens += usage.inputTokens + usage.outputTokens
        + (usage.cacheReadTokens ?? 0)
        + (usage.cacheWriteTokens ?? 0)
        + (usage.reasoningTokens ?? 0)
    }
    return tokens * this.policy.tokenPriceUsdPerMillion / 1_000_000
  }

  /** Dispose the run's Agent handle, keeping the durable record. */
  private async releaseHandle(runId: DutyRunId): Promise<void> {
    const handle = this.handles.get(runId)
    this.handles.delete(runId)
    this.locals.get(runId)?.controller.abort()
    if (handle !== undefined) await handle.dispose()
  }
}

export default DutyRunnerService
