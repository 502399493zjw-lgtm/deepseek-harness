# Durable duties

English | [中文](duty.zh.md)

Durable responsibility contracts, major-trigger runs, and the human decision inbox. The [duty-capability Agent Note](../../.agents/notes/implemented/feature/2026-08-16-duty-capability.md) owns the capability decisions; this page records the exact fields and variants from [`packages/duty/duty/src/types.ts`](../../packages/duty/duty/src/types.ts).

A Duty states what should happen and when. One major trigger creates exactly one run, and that run owns one Session for its whole life: retries, repairs, and human answers continue that Session rather than starting new runs. Durable Duty data lives in the `duty` storage domain, never in a Session log.

## Contract and state

`DutySpec` is the durable contract; `DutyState` is cross-trigger operational progress. Both are keyed by the [branded](core.md#branded-ids) `DutyId` and validated by zod schemas at the contract and durable boundaries.

```ts type-equiv
/**
 * How a Duty presents to the user. A Duty without a waking trigger runs once;
 * one with a trigger stays on duty. The distinction is presentation, not a
 * second execution path.
 */
type DutyMode = 'once' | 'standing'
```

```ts type-equiv
/** Whether a Duty may currently be woken. */
type DutyLifecycle = 'draft' | 'active' | 'paused' | 'archived'
```

```ts type-equiv
/** Why a Duty stopped waking itself. */
type DutyPauseReason = 'failures' | 'budget' | 'escalation' | 'human'
```

The trigger vocabulary is closed: `manual` never fires on its own, `interval` sits on a grid anchored to creation (`createdAt + k·everyMs`, `k ≥ 1`), and `cron` is the five-field numeric subset with Vixie OR day semantics (0 and 7 both mean Sunday). The execution body is structured data bounded at the contract boundary: at most 30 steps, depth 5, parallel fan-out 8, per-run budget ≤ 20 USD, agent steps with prompts, and gated tools drawn from the allowance.

## Runs and the single-run claim

```ts type-equiv
/** How one run ended, or that it has not ended. */
type DutyRunStatus =
  | 'running'
  | 'waiting_for_human'
  | 'succeeded'
  | 'failed'
  | 'canceled'
```

`ctx.duties.claim(dutyId, sessionId, cause)` holds the Duty's single-run slot and allocates the next run number inside one domain write-chain transform, so two triggers arriving together cannot both start a run. A refused claim returns the skip reason (`paused`, `archived`, `running`, `draft`, `not-due`), which the caller records in the trigger audit. `ctx.duties.settle` writes the final run record and applies policy: the cursor advances only on success, the failure count resets on success and pauses after `limits.maxConsecutiveFailures` consecutive failures, and an explicit `budget` pause applies immediately regardless of the count.

## Human decisions

A {@link HumanRequest} is a durable question bound to one run's Session. `ctx.duties.ask` opens it; `ctx.duties.answer` settles it, enforcing the offered options unless `allowFreeform`, and emits `duty/human-answered` only after the durable settle, so the run runtime resumes the exact Session that parked.

## Trigger seam and run runtime

`ctx.dutyTriggers` sweeps registered providers on `pollIntervalMs` (1000–60000 ms; the ceiling keeps a whole-minute cron match from falling between two sweeps) and publishes due observations as `duty/trigger` events. Provider `timer` reports interval and cron Duties; missed occurrences advance without replay.

`ctx.dutyRunner` turns an observation or manual start into a run: claim, create the run's Session and Agent with tools narrowed to `toolPolicy.allow` and gated tools denied, then drive the body. The Session log is the machine's only authority — `duty/run-bound`, `duty/step`, `duty/human-wait`, `duty/human-answer`, and `duty/run-finish` events fold into the machine state, so a parked run resumes after a restart by refolding the persisted log. The run-scoped tools `duty_adapt_body`, `duty_step_done`, and `duty_request_human` exist only on the run's Agent.


<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxduties--dutyservice"></a>

### `ctx.duties` — `DutyService`

Durable Duty contracts, operational state, run history, and human decisions.

Every mutation that must not interleave with another runs through the domain's `update` write chain, so a claim, a settle, and an answer arriving together are serialized by the medium rather than by a read-then-write race.

```ts cordis-catalog
/**
 * List every Duty with its current state, in creation order.
 * @returns frozen Duty views.
 */
list(): readonly DutyView[]

/**
 * Read one Duty and its state.
 * @param id - Duty identity.
 * @returns the frozen view, or `undefined` when no such Duty exists.
 */
get(id: DutyId): DutyView | undefined

/**
 * Create one Duty in `draft` and its initial state.
 * @param request - Validated contract fields; the Host assigns identity.
 * @returns the frozen created view.
 */
async create(request: CreateDutyRequest): Promise<DutyView>

/**
 * Replace the named contract fields of one Duty under compare-and-set.
 * @param id - Duty identity.
 * @param expected - The exact version the caller intends to replace.
 * @param request - Fields to replace.
 * @returns the frozen updated view.
 */
async edit(id: DutyId, expected: DutyVersion, request: EditDutyRequest): Promise<DutyView>

/**
 * Move one Duty to a new lifecycle, recording why when it pauses.
 * @param id - Duty identity.
 * @param lifecycle - The lifecycle to enter.
 * @param reason - Required when entering `paused`.
 * @returns the frozen updated state.
 */
async setLifecycle( id: DutyId, lifecycle: DutyLifecycle, reason?: DutyPauseReason, ): Promise<DutyState>

/**
 * Record when this Duty's trigger may next fire.
 * @param id - Duty identity.
 * @param nextWakeAt - Epoch milliseconds of the next permitted wake.
 * @returns the frozen updated state.
 */
async setNextWake(id: DutyId, nextWakeAt: number): Promise<DutyState>

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
async claim(id: DutyId, sessionId: SessionId, cause: DutyRunCause): Promise<DutyClaim>

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
async settle( id: DutyId, runId: DutyRunId, outcome: { readonly status: DutyRunStatus readonly summary?: string readonly costUsd?: number readonly cursor?: unknown readonly adapted?: boolean readonly pause?: DutyPauseReason }, ): Promise<DutyState>

/**
 * Read one Duty's run history, newest first.
 * @param id - Duty identity.
 * @returns frozen run records.
 */
runsOf(id: DutyId): readonly DutyRun[]

/**
 * Open one durable human decision and park its run.
 * @param request - The Duty, run, Session, question, and offered answers.
 * @returns the frozen open request.
 */
async ask(request: { readonly dutyId: DutyId readonly runId: DutyRunId readonly sessionId: SessionId readonly reason: HumanRequestReason readonly question: string readonly options?: readonly string[] readonly allowFreeform?: boolean }): Promise<HumanRequest>

/**
 * Answer one open human decision.
 * @param dutyId - Duty owning the request.
 * @param requestId - The request being answered.
 * @param answer - The human's verbatim answer.
 * @returns the frozen answered request.
 */
async answer(dutyId: DutyId, requestId: HumanRequestId, answer: string): Promise<HumanRequest>

/**
 * List one Duty's human decisions, newest first.
 * @param id - Duty identity.
 * @returns frozen request records.
 */
requestsOf(id: DutyId): readonly HumanRequest[]

/**
 * List every open human decision across all Duties, newest first.
 * @returns frozen open request records.
 */
openRequests(): readonly HumanRequest[]

/**
 * Record one waking decision, including a decision not to run.
 * @param event - The observed cause and its outcome, without identity or time.
 * @returns the frozen recorded event.
 */
async recordTrigger(event: { readonly dutyId: DutyId readonly cause: DutyRunCause readonly matched: boolean readonly skippedReason?: DutySkipReason readonly runId?: DutyRunId }): Promise<DutyTriggerEvent>

/**
 * List one Duty's trigger audit history, newest first.
 * @param id - Duty identity.
 * @returns frozen trigger events.
 */
triggerEventsOf(id: DutyId): readonly DutyTriggerEvent[]

/**
 * Remove one Duty and every record it owns.
 * @param id - Duty identity.
 * @returns `true` when a Duty was removed.
 */
async remove(id: DutyId): Promise<boolean>
```

Types: [SessionId](core.md)

Source: [`packages/duty/duty/src/index.ts:187`](../../packages/duty/duty/src/index.ts)

<a id="ctxdutyrunner--dutyrunnerservice"></a>

### `ctx.dutyRunner` — `DutyRunnerService`

Runtime that turns observations into runs and drives each run's Session to a terminal outcome. One claim from `ctx.duties` admits exactly one run; everything after the claim is this service's own machine.

```ts cordis-catalog
/**
 * Start one run by hand, bypassing the trigger seam.
 * @param dutyId - The Duty to run.
 * @param cause - Why a human or model asked for this run.
 * @returns the started run.
 */
async startRun(dutyId: DutyId, cause: DutyRunCause): Promise<DutyRun>
```

Source: [`packages/duty/duty-runner/src/index.ts:145`](../../packages/duty/duty-runner/src/index.ts)

<a id="ctxdutytriggers--dutytriggerservice"></a>

### `ctx.dutyTriggers` — `DutyTriggerService`

Registry of waking sources. Providers register idempotently; one sweep polls every registered provider once at the current wall clock and emits each returned observation. Sweeps never overlap: the next timer arms after the current sweep settles, re-reading the clock rather than accumulating drift.

```ts cordis-catalog
/**
 * Register one waking source.
 * @param provider - The provider to register under its id.
 * @returns the disposer that unregisters it.
 */
registerProvider(provider: DutyTriggerProvider): () => void

/**
 * Registered provider ids, in registration order.
 * @returns the current provider id list.
 */
providerIds(): readonly string[]

/**
 * Run one complete sweep now, polling every provider at the current wall
 * clock and emitting each observation. Concurrent callers share the one
 * in-flight sweep.
 * @returns resolution after every provider has been polled and every
 * observation emitted.
 */
sweep(): Promise<void>
```

Source: [`packages/duty/duty-trigger/src/index.ts:60`](../../packages/duty/duty-trigger/src/index.ts)

<a id="duty-events"></a>

### `duty/*` events

<a id="dutyhuman-answered--emit"></a>

#### `duty/human-answered` — emit

One durable human decision was answered and is now settled. The run runtime listens for this to resume the parked run's Session.

```ts cordis-catalog
/**
 * One durable human decision was answered and is now settled. The run
 * runtime listens for this to resume the parked run's Session.
 * @param request - the answered request, with the human's verbatim answer.
 * @mode emit
 */
'duty/human-answered'(request: HumanRequest): void
```

Source: [`packages/duty/duty/src/index.ts:82`](../../packages/duty/duty/src/index.ts)

<a id="dutytrigger--emit"></a>

#### `duty/trigger` — emit

One provider's waking observation, published per sweep in provider registration order. Listeners consume the candidate: they may claim a run, record a skip, or ignore it; the registry makes no decision.

```ts cordis-catalog
/**
 * One provider's waking observation, published per sweep in provider
 * registration order. Listeners consume the candidate: they may claim a
 * run, record a skip, or ignore it; the registry makes no decision.
 * @param observation - the normalized waking observation.
 * @mode emit
 */
'duty/trigger'(observation: DutyTriggerObservation): void
```

Source: [`packages/duty/duty-trigger/src/index.ts:33`](../../packages/duty/duty-trigger/src/index.ts)
<!-- END GENERATED cordis-surface -->

## Configuration

| Package | Key | Meaning |
|---|---|---|
| `dsh-duty` | `defaultMaxConsecutiveFailures` | 1–20; consecutive failed runs tolerated before a Duty pauses itself |
| `dsh-duty` | `runHistoryLimit`, `triggerEventLimit` | retention per Duty for run records and trigger audit events |
| `dsh-duty-trigger` | `pollIntervalMs` | 1000–60000; milliseconds between sweep starts |
| `dsh-duty-runner` | `subagentProvider` | subagent provider for `parallel` fan-out; defaults to `fork` |
| `dsh-duty-runner` | `tokenPriceUsdPerMillion` | blended USD price per million tokens; `0` disables cost accounting |
| `dsh-duty-runner` | `maxRepairs` | 0–5; repairs per agent step after the first attempt |
