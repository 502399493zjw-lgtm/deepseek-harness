/**
 * The Duty domain: durable responsibility contracts, their operational state,
 * major-trigger run history, and durable human decisions.
 *
 * A Duty states what should happen and when. One major trigger creates exactly
 * one {@link DutyRun}, and that run owns one Session for its whole life —
 * retries, repairs, and human answers continue that Session rather than
 * starting new runs. Durable Duty data lives in the `duty` storage domain,
 * never in a Session log, because it must outlive every Session it creates.
 * @module @deepseek-ai/dsh-duty
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session/types'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import {
  dutyDomainSpec,
  dutySpecSchema,
  type DutyRunsRow,
  type DutyTriggerEventsRow,
  type HumanRequestsRow,
} from './spec.ts'
import type {
  CreateDutyRequest,
  DutyId,
  DutyLifecycle,
  DutyPauseReason,
  DutyRun,
  DutyRunCause,
  DutyRunId,
  DutyRunStatus,
  DutySkipReason,
  DutySpec,
  DutyState,
  DutyTriggerEvent,
  DutyVersion,
  DutyView,
  EditDutyRequest,
  HumanRequest,
  HumanRequestId,
  HumanRequestReason,
} from './types.ts'

// The id factories live beside their types in types.ts (the dsh-session
// SessionId precedent): a type and a value of one name must be declared in
// one module to be re-exported together. A single export * carries every
// meaning; an explicit type re-export of the same names would shadow the
// factory values.
export * from './types.ts'
export {
  dutyBodySchema,
  dutyDomainSpec,
  dutyLimitsSchema,
  dutyRunSchema,
  dutySpecSchema,
  dutyStateSchema,
  dutyStepSchema,
  dutyToolPolicySchema,
  dutyTriggerSchema,
  humanRequestSchema,
  MAX_BODY_DEPTH,
  MAX_BODY_STEPS,
  MAX_BUDGET_USD,
  MAX_PARALLEL_WIDTH,
} from './spec.ts'
export type { DutyRunsRow, DutyTriggerEventsRow, HumanRequestsRow } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    duties: DutyService
  }

  interface Events {
    /**
     * One durable human decision was answered and is now settled. The run
     * runtime listens for this to resume the parked run's Session.
     * @param request - the answered request, with the human's verbatim answer.
     * @mode emit
     */
    'duty/human-answered'(request: HumanRequest): void
  }
}

/** Deployment policy for Duty defaults and audit retention. */
export interface Config {
  /** Consecutive failed runs tolerated before a Duty pauses itself. */
  readonly defaultMaxConsecutiveFailures: number
  /** Run records retained per Duty; older records are dropped newest-first. */
  readonly runHistoryLimit: number
  /** Trigger audit events retained per Duty. */
  readonly triggerEventLimit: number
}

/** Closed failure vocabulary of the Duty service. */
export type DutyErrorCode =
  | 'duty-not-found'
  | 'run-not-found'
  | 'human-request-not-found'
  | 'version-conflict'
  | 'duty-running'
  | 'duty-not-runnable'
  | 'request-already-settled'
  | 'invalid-contract'
  | 'duty-exists'
  | 'answer-not-offered'
  | 'domain-not-open'

/** A Duty operation rejected for a named, stable reason. */
export class DutyError extends Error {
  /** Stable machine-routable classification. */
  readonly code: DutyErrorCode

  /**
   * Build one classified Duty failure.
   * @param code - Stable classification.
   * @param message - Human-readable explanation.
   */
  constructor(code: DutyErrorCode, message: string) {
    super(message)
    this.name = 'DutyError'
    this.code = code
  }
}

/** Outcome of a claim attempt: either the started run or why none started. */
export type DutyClaim =
  | { readonly claimed: true; readonly run: DutyRun }
  | { readonly claimed: false; readonly reason: DutySkipReason }

/** Render an unknown failure for process-local diagnostics only. */
function renderThrown(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Freeze one spec before it crosses the service boundary. */
function snapshotSpec(spec: DutySpec): DutySpec {
  return Object.freeze({ ...spec, escalation: Object.freeze([...spec.escalation]) })
}

/** Freeze one state record before it crosses the service boundary. */
function snapshotState(state: DutyState): DutyState {
  return Object.freeze({ ...state })
}

/** Freeze one run record before it crosses the service boundary. */
function snapshotRun(run: DutyRun): DutyRun {
  return Object.freeze({ ...run, cause: Object.freeze({ ...run.cause }) })
}

/** Freeze one human request before it crosses the service boundary. */
function snapshotRequest(request: HumanRequest): HumanRequest {
  return Object.freeze({ ...request, options: Object.freeze([...request.options]) })
}




/** Whether a settled status ends the run. */
function isSettled(status: DutyRunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

/**
 * Validate one assembled contract before it is stored.
 *
 * Duty contracts arrive from tool JSON and slash-command parsing, so the
 * durable schema is enforced here rather than only on reopen: an unsatisfiable
 * body or a gated tool outside the allowance must be refused while a caller is
 * still present to see why.
 * @param spec - The fully assembled contract.
 * @returns the same contract once every durable rule accepts it.
 */
function validateSpec(spec: DutySpec): DutySpec {
  const result = dutySpecSchema.safeParse(spec)
  if (!result.success) {
    const detail = result.error.issues
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new DutyError('invalid-contract', `duty contract is not storable: ${detail}`)
  }
  return spec
}

/**
 * Durable Duty contracts, operational state, run history, and human decisions.
 *
 * Every mutation that must not interleave with another runs through the
 * domain's `update` write chain, so a claim, a settle, and an answer arriving
 * together are serialized by the medium rather than by a read-then-write race.
 */
export class DutyService extends TypertRemoteService {
  static inject = ['storageDomain']

  /** Loader validation for the required Duty defaults and retention policy. */
  static Config: s<Config> = s.object({
    defaultMaxConsecutiveFailures: s.number().step(1).min(1).max(20).required(),
    runHistoryLimit: s.number().step(1).min(1).required(),
    triggerEventLimit: s.number().step(1).min(1).required(),
  })

  private readonly policy: Config
  private specs?: KvTable<DutyId, DutySpec>
  private state?: KvTable<DutyId, DutyState>
  private runs?: KvTable<DutyId, DutyRunsRow>
  private humanRequests?: KvTable<DutyId, HumanRequestsRow>
  private triggerEvents?: KvTable<DutyId, DutyTriggerEventsRow>

  /**
   * Compose the Duty service and adopt its deployment policy.
   * @param ctx - Cordis context carrying the storage-domain facility.
   * @param config - Validated deployment policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'duties')
    this.policy = config
  }

  /** Open and own the one durable Duty domain before any read or write. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(dutyDomainSpec)
    this.specs = domain.table('specs')
    this.state = domain.table('state')
    this.runs = domain.table('runs')
    this.humanRequests = domain.table('human_requests')
    this.triggerEvents = domain.table('trigger_events')
  }

  /**
   * List every Duty with its current state, in creation order.
   * @returns frozen Duty views.
   */
  @Remote('list')
  list(): readonly DutyView[] {
    const specs = this.requireSpecs()
    const state = this.requireState()
    const views: DutyView[] = []
    for (const [id, spec] of specs.entries()) {
      const current = state.get(id)
      if (current === undefined) continue
      views.push(Object.freeze({ spec: snapshotSpec(spec), state: snapshotState(current) }))
    }
    views.sort((left, right) => left.spec.createdAt - right.spec.createdAt)
    return Object.freeze(views)
  }

  /**
   * Read one Duty and its state.
   * @param id - Duty identity.
   * @returns the frozen view, or `undefined` when no such Duty exists.
   */
  @Remote('get')
  get(id: DutyId): DutyView | undefined {
    const spec = this.requireSpecs().get(id)
    const current = this.requireState().get(id)
    if (spec === undefined || current === undefined) return undefined
    return Object.freeze({ spec: snapshotSpec(spec), state: snapshotState(current) })
  }

  /**
   * Create one Duty in `draft` and its initial state.
   * @param request - Validated contract fields; the Host assigns identity.
   * @returns the frozen created view.
   */
  @Remote('create')
  async create(request: CreateDutyRequest): Promise<DutyView> {
    const now = Date.now()
    // A caller-supplied id makes creation idempotent: a retry names the same
    // identity and fails as a duplicate instead of minting a second Duty.
    const supplied = request.id
    if (supplied !== undefined) {
      const format = z.uuid().safeParse(supplied)
      if (!format.success) {
        throw new DutyError('invalid-contract', `duty id must be a uuid, got '${supplied}'`)
      }
      if (this.requireSpecs().get(supplied as DutyId) !== undefined) {
        throw new DutyError('duty-exists', `duty '${supplied}' already exists`)
      }
    }
    const id = (supplied ?? randomUUID()) as DutyId
    const spec: DutySpec = {
      id,
      title: request.title,
      mode: request.trigger.kind === 'manual' ? 'once' : 'standing',
      goal: request.goal,
      ...(request.scope === undefined ? {} : { scope: request.scope }),
      trigger: request.trigger,
      body: request.body,
      toolPolicy: request.toolPolicy,
      limits: {
        maxConsecutiveFailures:
          request.limits?.maxConsecutiveFailures ?? this.policy.defaultMaxConsecutiveFailures,
        ...(request.limits?.budgetUsd === undefined ? {} : { budgetUsd: request.limits.budgetUsd }),
      },
      escalation: request.escalation ?? [],
      ...(request.reporting === undefined ? {} : { reporting: request.reporting }),
      ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
      version: randomUUID() as DutyVersion,
      createdAt: now,
      updatedAt: now,
    }
    const initial: DutyState = {
      dutyId: id,
      lifecycle: 'draft',
      runCount: 0,
      running: false,
      consecutiveFailures: 0,
    }
    validateSpec(spec)
    await this.requireSpecs().put(id, spec)
    await this.requireState().put(id, initial)
    return Object.freeze({ spec: snapshotSpec(spec), state: snapshotState(initial) })
  }

  /**
   * Replace the named contract fields of one Duty under compare-and-set.
   * @param id - Duty identity.
   * @param expected - The exact version the caller intends to replace.
   * @param request - Fields to replace.
   * @returns the frozen updated view.
   */
  @Remote('edit')
  async edit(id: DutyId, expected: DutyVersion, request: EditDutyRequest): Promise<DutyView> {
    const next = await this.requireSpecs().update(id, (current) => {
      if (current.version !== expected) {
        throw new DutyError('version-conflict', `duty '${id}' moved past version '${expected}'`)
      }
      const trigger = request.trigger ?? current.trigger
      return validateSpec({
        ...current,
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.goal === undefined ? {} : { goal: request.goal }),
        ...(request.scope === undefined ? {} : { scope: request.scope }),
        trigger,
        mode: trigger.kind === 'manual' ? 'once' : 'standing',
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(request.toolPolicy === undefined ? {} : { toolPolicy: request.toolPolicy }),
        ...(request.limits === undefined ? {} : {
          limits: {
            maxConsecutiveFailures:
              request.limits.maxConsecutiveFailures ?? current.limits.maxConsecutiveFailures,
            ...(request.limits.budgetUsd === undefined
              ? {}
              : { budgetUsd: request.limits.budgetUsd }),
          },
        }),
        ...(request.escalation === undefined ? {} : { escalation: request.escalation }),
        ...(request.reporting === undefined ? {} : { reporting: request.reporting }),
        ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
        version: randomUUID() as DutyVersion,
        updatedAt: Date.now(),
      })
    }).catch(this.rethrowMissing(id))
    const current = this.requireState().get(id)
    if (current === undefined) throw new DutyError('duty-not-found', `duty '${id}' has no state`)
    return Object.freeze({ spec: snapshotSpec(next), state: snapshotState(current) })
  }

  /**
   * Move one Duty to a new lifecycle, recording why when it pauses.
   * @param id - Duty identity.
   * @param lifecycle - The lifecycle to enter.
   * @param reason - Required when entering `paused`.
   * @returns the frozen updated state.
   */
  @Remote('setLifecycle')
  async setLifecycle(
    id: DutyId,
    lifecycle: DutyLifecycle,
    reason?: DutyPauseReason,
  ): Promise<DutyState> {
    const next = await this.requireState().update(id, (current) => {
      // Leaving `paused` drops the reason by omission: under
      // exactOptionalPropertyTypes an explicit `undefined` is not an absent key.
      const { pausedReason: _cleared, ...rest } = current
      return lifecycle === 'paused'
        ? { ...rest, lifecycle, pausedReason: reason ?? current.pausedReason ?? 'human' }
        : { ...rest, lifecycle }
    }).catch(this.rethrowMissing(id))
    return snapshotState(next)
  }

  /**
   * Record when this Duty's trigger may next fire.
   * @param id - Duty identity.
   * @param nextWakeAt - Epoch milliseconds of the next permitted wake.
   * @returns the frozen updated state.
   */
  async setNextWake(id: DutyId, nextWakeAt: number): Promise<DutyState> {
    const next = await this.requireState()
      .update(id, current => ({ ...current, nextWakeAt }))
      .catch(this.rethrowMissing(id))
    return snapshotState(next)
  }

  /**
   * Claim this Duty's single run slot and open one run record.
   *
   * The claim and the run-number allocation happen inside one write-chain
   * transform, so two triggers arriving together cannot both start a run or
   * receive the same index.
   * @param id - Duty identity.
   * @param sessionId - The Session that will own this run's transcript.
   * @param cause - What woke this run.
   * @returns the started run, or the reason no run started.
   */
  async claim(id: DutyId, sessionId: SessionId, cause: DutyRunCause): Promise<DutyClaim> {
    let skipped: DutySkipReason | undefined
    let run: DutyRun | undefined
    const startedAt = Date.now()
    const runId = randomUUID() as DutyRunId
    await this.requireState().update(id, (current) => {
      if (current.running) {
        skipped = 'running'
        return current
      }
      if (current.lifecycle === 'paused') {
        skipped = 'paused'
        return current
      }
      if (current.lifecycle === 'archived') {
        skipped = 'archived'
        return current
      }
      if (current.lifecycle === 'draft') {
        skipped = 'draft'
        return current
      }
      const index = current.runCount + 1
      run = {
        id: runId,
        dutyId: id,
        index,
        sessionId,
        cause,
        status: 'running',
        startedAt,
        adapted: false,
      }
      return {
        ...current,
        running: true,
        runCount: index,
        lastRunId: runId,
        lastRunAt: startedAt,
        lastOutcome: 'running',
      }
    }).catch(this.rethrowMissing(id))
    if (run === undefined) {
      return Object.freeze({ claimed: false, reason: skipped ?? 'not-due' })
    }
    await this.appendRun(id, run)
    return Object.freeze({ claimed: true, run: snapshotRun(run) })
  }

  /**
   * Settle one run and apply the Duty's failure, budget, and cursor policy.
   *
   * The cursor advances only when the run succeeded, so a crash or failure
   * mid-run never moves the Duty past work it did not finish.
   * @param id - Duty identity.
   * @param runId - The run being settled.
   * @param outcome - Final status, summary, cost, and any committed cursor.
   * @returns the frozen state after settlement.
   */
  async settle(
    id: DutyId,
    runId: DutyRunId,
    outcome: {
      readonly status: DutyRunStatus
      readonly summary?: string
      readonly costUsd?: number
      readonly cursor?: JsonValue
      readonly adapted?: boolean
      readonly pause?: DutyPauseReason
    },
  ): Promise<DutyState> {
    const spec = this.requireSpecs().get(id)
    if (spec === undefined) throw new DutyError('duty-not-found', `no duty '${id}'`)
    const completedAt = Date.now()
    await this.requireRuns().update(id, (row) => {
      const runs = row.runs.map((record) => {
        if (record.id !== runId) return record
        return {
          ...record,
          status: outcome.status,
          ...(isSettled(outcome.status) ? { completedAt } : {}),
          ...(outcome.summary === undefined ? {} : { summary: outcome.summary }),
          ...(outcome.costUsd === undefined ? {} : { costUsd: outcome.costUsd }),
          ...(outcome.adapted === undefined ? {} : { adapted: outcome.adapted }),
        }
      })
      return { runs }
    }).catch(this.rethrowMissing(id))

    const next = await this.requireState().update(id, (current) => {
      const succeeded = outcome.status === 'succeeded'
      const failed = outcome.status === 'failed'
      const consecutiveFailures = succeeded ? 0 : failed ? current.consecutiveFailures + 1 : current.consecutiveFailures
      const exhausted = consecutiveFailures >= spec.limits.maxConsecutiveFailures
      const pauseReason: DutyPauseReason | undefined =
        outcome.pause ?? (failed && exhausted ? 'failures' : undefined)
      // A run parked on a human decision keeps the claim: the same run resumes
      // in the same Session once answered, so the Duty is not free to wake again.
      const stillRunning = outcome.status === 'waiting_for_human'
      return {
        ...current,
        running: stillRunning,
        lastOutcome: outcome.status,
        consecutiveFailures,
        ...(succeeded && outcome.cursor !== undefined ? { cursor: outcome.cursor } : {}),
        ...(pauseReason === undefined
          ? {}
          : { lifecycle: 'paused', pausedReason: pauseReason }),
      }
    }).catch(this.rethrowMissing(id))
    return snapshotState(next)
  }

  /**
   * Read one Duty's run history, newest first.
   * @param id - Duty identity.
   * @returns frozen run records.
   */
  @Remote('runsOf')
  runsOf(id: DutyId): readonly DutyRun[] {
    const row = this.requireRuns().get(id)
    if (row === undefined) return Object.freeze([])
    return Object.freeze(row.runs.map(snapshotRun))
  }

  /**
   * Open one durable human decision and park its run.
   * @param request - The Duty, run, Session, question, and offered answers.
   * @returns the frozen open request.
   */
  async ask(request: {
    readonly dutyId: DutyId
    readonly runId: DutyRunId
    readonly sessionId: SessionId
    readonly reason: HumanRequestReason
    readonly question: string
    readonly options?: readonly string[]
    readonly allowFreeform?: boolean
  }): Promise<HumanRequest> {
    const record: HumanRequest = {
      id: randomUUID() as HumanRequestId,
      dutyId: request.dutyId,
      runId: request.runId,
      sessionId: request.sessionId,
      status: 'open',
      reason: request.reason,
      question: request.question,
      options: request.options ?? [],
      allowFreeform: request.allowFreeform ?? (request.options ?? []).length === 0,
      createdAt: Date.now(),
    }
    await this.requireHumanRequests().update(request.dutyId, row => ({
      requests: [record, ...row.requests],
    })).catch(async () => {
      await this.requireHumanRequests().put(request.dutyId, { requests: [record] })
    })
    return snapshotRequest(record)
  }

  /**
   * Answer one open human decision.
   * @param dutyId - Duty owning the request.
   * @param requestId - The request being answered.
   * @param answer - The human's verbatim answer.
   * @returns the frozen answered request.
   */
  @Remote('answer')
  async answer(dutyId: DutyId, requestId: HumanRequestId, answer: string): Promise<HumanRequest> {
    let answered: HumanRequest | undefined
    await this.requireHumanRequests().update(dutyId, (row) => {
      const target = row.requests.find(request => request.id === requestId)
      if (target === undefined) {
        throw new DutyError('human-request-not-found', `no human request '${requestId}'`)
      }
      if (target.status !== 'open') {
        throw new DutyError('request-already-settled', `human request '${requestId}' is ${target.status}`)
      }
      if (!target.allowFreeform && !target.options.includes(answer)) {
        throw new DutyError('answer-not-offered', 'answer is not one of the offered options')
      }
      answered = { ...target, status: 'answered', answeredAt: Date.now(), answer }
      const replacement = { ...answered }
      return {
        requests: row.requests.map(request => request.id === requestId ? replacement : request),
      }
    }).catch(this.rethrowMissing(dutyId))
    if (answered === undefined) {
      throw new DutyError('human-request-not-found', `no human request '${requestId}'`)
    }
    const frozen = snapshotRequest(answered)
    // Emitted only after the durable settle: listeners may resume a run.
    this.ctx.emit('duty/human-answered', frozen)
    return frozen
  }

  /**
   * List one Duty's human decisions, newest first.
   * @param id - Duty identity.
   * @returns frozen request records.
   */
  @Remote('requestsOf')
  requestsOf(id: DutyId): readonly HumanRequest[] {
    const row = this.requireHumanRequests().get(id)
    if (row === undefined) return Object.freeze([])
    return Object.freeze(row.requests.map(snapshotRequest))
  }

  /**
   * List every open human decision across all Duties, newest first.
   * @returns frozen open request records.
   */
  @Remote('openRequests')
  openRequests(): readonly HumanRequest[] {
    const open: HumanRequest[] = []
    for (const [, row] of this.requireHumanRequests().entries()) {
      for (const request of row.requests) {
        if (request.status === 'open') open.push(snapshotRequest(request))
      }
    }
    open.sort((left, right) => right.createdAt - left.createdAt)
    return Object.freeze(open)
  }

  /**
   * Record one waking decision, including a decision not to run.
   * @param event - The observed cause and its outcome, without identity or time.
   * @returns the frozen recorded event.
   */
  async recordTrigger(event: {
    readonly dutyId: DutyId
    readonly cause: DutyRunCause
    readonly matched: boolean
    readonly skippedReason?: DutySkipReason
    readonly runId?: DutyRunId
  }): Promise<DutyTriggerEvent> {
    const record: DutyTriggerEvent = {
      id: randomUUID(),
      dutyId: event.dutyId,
      cause: event.cause,
      matched: event.matched,
      ...(event.skippedReason === undefined ? {} : { skippedReason: event.skippedReason }),
      ...(event.runId === undefined ? {} : { runId: event.runId }),
      createdAt: Date.now(),
    }
    const limit = this.policy.triggerEventLimit
    const table = this.requireTriggerEvents()
    const existing = table.get(event.dutyId)
    if (existing === undefined) {
      await table.put(event.dutyId, { events: [record] })
    } else {
      await table.update(event.dutyId, row => ({
        events: [record, ...row.events].slice(0, limit),
      }))
    }
    return Object.freeze({ ...record, cause: Object.freeze({ ...record.cause }) })
  }

  /**
   * Wake one active Duty by hand through the optional run runtime. The Duty
   * domain itself never starts a run: the runtime owns Session and Agent
   * creation, so this verb reports a missing runtime instead of executing.
   * @param id - Duty identity.
   * @param reason - Why a human or model asked for this run.
   * @returns the started run id, or a named failure when no runtime is
   * loaded or the Duty cannot run.
   */
  @Remote('start')
  async start(id: DutyId, reason: string): Promise<
    { ok: true; runId: DutyRunId } | { ok: false; code: string; error: string }
  > {
    const runner = this.ctx.get('dutyRunner') as
      { startRun(dutyId: DutyId, cause: DutyRunCause): Promise<DutyRun> } | undefined
    if (runner === undefined) {
      return { ok: false, code: 'runner-not-loaded', error: 'the duty run runtime is not loaded' }
    }
    try {
      const run = await runner.startRun(id, { kind: 'manual', reason })
      return { ok: true, runId: run.id }
    } catch (error: unknown) {
      if (error instanceof DutyError) return { ok: false, code: error.code, error: error.message }
      return { ok: false, code: 'start-failed', error: renderThrown(error) }
    }
  }

  /**
   * List one Duty's trigger audit history, newest first.
   * @param id - Duty identity.
   * @returns frozen trigger events.
   */
  @Remote('triggerEventsOf')
  triggerEventsOf(id: DutyId): readonly DutyTriggerEvent[] {
    const row = this.requireTriggerEvents().get(id)
    if (row === undefined) return Object.freeze([])
    return Object.freeze(row.events.map(event =>
      Object.freeze({ ...event, cause: Object.freeze({ ...event.cause }) })))
  }

  /**
   * Remove one Duty and every record it owns.
   * @param id - Duty identity.
   * @returns `true` when a Duty was removed.
   */
  @Remote('remove')
  async remove(id: DutyId): Promise<boolean> {
    const existed = this.requireSpecs().get(id) !== undefined
    await this.requireSpecs().delete(id)
    await this.requireState().delete(id)
    await this.requireRuns().delete(id)
    await this.requireHumanRequests().delete(id)
    await this.requireTriggerEvents().delete(id)
    return existed
  }

  /** Append one run record, trimming history to the configured retention. */
  private async appendRun(id: DutyId, run: DutyRun): Promise<void> {
    const limit = this.policy.runHistoryLimit
    const table = this.requireRuns()
    if (table.get(id) === undefined) {
      await table.put(id, { runs: [run] })
      return
    }
    await table.update(id, row => ({ runs: [run, ...row.runs].slice(0, limit) }))
  }

  /** Translate a missing-key rejection into the Duty vocabulary. */
  private rethrowMissing(id: DutyId): (cause: unknown) => never {
    return (cause: unknown) => {
      if (cause instanceof DutyError) throw cause
      throw new DutyError('duty-not-found', `no duty '${id}': ${String(cause)}`)
    }
  }

  /** Resolve the opened spec table or fail a broken service lifecycle. */
  private requireSpecs(): KvTable<DutyId, DutySpec> {
    if (this.specs === undefined) throw new DutyError('domain-not-open', 'duty domain is not open')
    return this.specs
  }

  /** Resolve the opened state table or fail a broken service lifecycle. */
  private requireState(): KvTable<DutyId, DutyState> {
    if (this.state === undefined) throw new DutyError('domain-not-open', 'duty domain is not open')
    return this.state
  }

  /** Resolve the opened run-history table or fail a broken service lifecycle. */
  private requireRuns(): KvTable<DutyId, DutyRunsRow> {
    if (this.runs === undefined) throw new DutyError('domain-not-open', 'duty domain is not open')
    return this.runs
  }

  /** Resolve the opened human-decision table or fail a broken service lifecycle. */
  private requireHumanRequests(): KvTable<DutyId, HumanRequestsRow> {
    if (this.humanRequests === undefined) {
      throw new DutyError('domain-not-open', 'duty domain is not open')
    }
    return this.humanRequests
  }

  /** Resolve the opened trigger-audit table or fail a broken service lifecycle. */
  private requireTriggerEvents(): KvTable<DutyId, DutyTriggerEventsRow> {
    if (this.triggerEvents === undefined) {
      throw new DutyError('domain-not-open', 'duty domain is not open')
    }
    return this.triggerEvents
  }
}

export default DutyService
