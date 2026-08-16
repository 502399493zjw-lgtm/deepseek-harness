# 持久化职责(Duty)

[English](duty.md) | 中文

持久化职责合约、主触发 run 与人工决策收件箱。[duty-capability Agent Note](../../.agents/notes/implemented/feature/2026-08-16-duty-capability.md) 记录能力决策;本页记录 [`packages/duty/duty/src/types.ts`](../../packages/duty/duty/src/types.ts) 中的精确字段与变体。

一个 Duty 说明要做什么、何时做。一次主触发恰好产生一个 run,该 run 终其一生拥有同一个 Session:重试、修复与人工答复都延续该 Session,而不是开启新 run。持久化 Duty 数据存放在 `duty` 存储域中,绝不放进 Session 日志。

## 合约与状态

`DutySpec` 是持久化合约;`DutyState` 是跨触发的运行进度。二者都以 [branded](core.md#branded-ids) 的 `DutyId` 为键,并由 zod schema 在合约边界与持久化边界校验。

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

触发词表是封闭的:`manual` 从不自行触发,`interval` 锚定在创建时间上的网格(`createdAt + k·everyMs`,`k ≥ 1`),`cron` 是五段数值子集、Vixie OR 日期语义(0 与 7 都表示周日)。执行 body 是结构化数据,在合约边界设限:最多 30 步、深度 5、parallel 扇出 8、单 run 预算 ≤ 20 美元、agent 步骤必须有 prompt、gated 工具必须是 allow 的子集。

## run 与单 run claim

```ts type-equiv
/** How one run ended, or that it has not ended. */
type DutyRunStatus =
  | 'running'
  | 'waiting_for_human'
  | 'succeeded'
  | 'failed'
  | 'canceled'
```

`ctx.duties.claim(dutyId, sessionId, cause)` 在一次域写链变换内占住 Duty 的单 run 名额并分配下一个 run 编号,因此同时到达的两个触发不可能都启动 run。被拒绝的 claim 返回跳过原因(`paused`、`archived`、`running`、`draft`、`not-due`),由调用方记入触发审计。`ctx.duties.settle` 写入最终 run 记录并执行策略:cursor 只在成功时推进,失败计数在成功时清零、连续失败达 `limits.maxConsecutiveFailures` 次后暂停,显式的 `budget` 暂停与失败次数无关、立即生效。

## 人工决策

{@link HumanRequest} 是绑定到某个 run 的 Session 上的持久化问题。`ctx.duties.ask` 开启它;`ctx.duties.answer` 结清它,除非 `allowFreeform` 否则强制限定选项,并且只在持久化落定之后才发出 `duty/human-answered`,让 run 运行时恢复那个恰好停靠的 Session。

## 触发 seam 与 run 运行时

`ctx.dutyTriggers` 按 `pollIntervalMs`(1000–60000 毫秒;上限保证整分钟 cron 匹配不会落在两次 sweep 之间)轮询已注册 provider,并把到期的观测发布为 `duty/trigger` 事件。provider `timer` 报告 interval 与 cron 类型的 Duty;错过的发生点只前进、不重放。

`ctx.dutyRunner` 把观测或手动启动变成 run:先 claim,用 `toolPolicy.allow` 收敛工具、拒绝 gated 工具,创建 run 的 Session 与 Agent,然后执行 body。Session 日志是机器状态的唯一权威——`duty/run-bound`、`duty/step`、`duty/human-wait`、`duty/human-answer`、`duty/run-finish` 事件折叠出机器状态,因此停靠的 run 在重启后靠重放持久化日志恢复。run 作用域内的工具 `duty_adapt_body`、`duty_step_done`、`duty_request_human` 只存在于该 run 的 Agent 上。


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
@Remote('list') list(): readonly DutyView[]

/**
 * Read one Duty and its state.
 * @param id - Duty identity.
 * @returns the frozen view, or `undefined` when no such Duty exists.
 */
@Remote('get') get(id: DutyId): DutyView | undefined

/**
 * Create one Duty in `draft` and its initial state.
 * @param request - Validated contract fields; the Host assigns identity.
 * @returns the frozen created view.
 */
@Remote('create') async create(request: CreateDutyRequest): Promise<DutyView>

/**
 * Replace the named contract fields of one Duty under compare-and-set.
 * @param id - Duty identity.
 * @param expected - The exact version the caller intends to replace.
 * @param request - Fields to replace.
 * @returns the frozen updated view.
 */
@Remote('edit') async edit(id: DutyId, expected: DutyVersion, request: EditDutyRequest): Promise<DutyView>

/**
 * Move one Duty to a new lifecycle, recording why when it pauses.
 * @param id - Duty identity.
 * @param lifecycle - The lifecycle to enter.
 * @param reason - Required when entering `paused`.
 * @returns the frozen updated state.
 */
@Remote('setLifecycle') async setLifecycle( id: DutyId, lifecycle: DutyLifecycle, reason?: DutyPauseReason, ): Promise<DutyState>

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
async settle( id: DutyId, runId: DutyRunId, outcome: { readonly status: DutyRunStatus readonly summary?: string readonly costUsd?: number readonly cursor?: JsonValue readonly adapted?: boolean readonly pause?: DutyPauseReason }, ): Promise<DutyState>

/**
 * Read one Duty's run history, newest first.
 * @param id - Duty identity.
 * @returns frozen run records.
 */
@Remote('runsOf') runsOf(id: DutyId): readonly DutyRun[]

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
@Remote('answer') async answer(dutyId: DutyId, requestId: HumanRequestId, answer: string): Promise<HumanRequest>

/**
 * List one Duty's human decisions, newest first.
 * @param id - Duty identity.
 * @returns frozen request records.
 */
@Remote('requestsOf') requestsOf(id: DutyId): readonly HumanRequest[]

/**
 * List every open human decision across all Duties, newest first.
 * @returns frozen open request records.
 */
@Remote('openRequests') openRequests(): readonly HumanRequest[]

/**
 * Record one waking decision, including a decision not to run.
 * @param event - The observed cause and its outcome, without identity or time.
 * @returns the frozen recorded event.
 */
async recordTrigger(event: { readonly dutyId: DutyId readonly cause: DutyRunCause readonly matched: boolean readonly skippedReason?: DutySkipReason readonly runId?: DutyRunId }): Promise<DutyTriggerEvent>

/**
 * Wake one active Duty by hand through the optional run runtime. The Duty
 * domain itself never starts a run: the runtime owns Session and Agent
 * creation, so this verb reports a missing runtime instead of executing.
 * @param id - Duty identity.
 * @param reason - Why a human or model asked for this run.
 * @returns the started run id, or a named failure when no runtime is
 * loaded or the Duty cannot run.
 */
@Remote('start') async start(id: DutyId, reason: string): Promise< { ok: true; runId: DutyRunId } | { ok: false; code: string; error: string } >

/**
 * List one Duty's trigger audit history, newest first.
 * @param id - Duty identity.
 * @returns frozen trigger events.
 */
@Remote('triggerEventsOf') triggerEventsOf(id: DutyId): readonly DutyTriggerEvent[]

/**
 * Remove one Duty and every record it owns.
 * @param id - Duty identity.
 * @returns `true` when a Duty was removed.
 */
@Remote('remove') async remove(id: DutyId): Promise<boolean>
```

Types: [SessionId](core.md)

Source: [`packages/duty/duty/src/index.ts:195`](../../packages/duty/duty/src/index.ts)

<a id="ctxdutyrunner--dutyrunnerservice"></a>

### `ctx.dutyRunner` — `DutyRunnerService`

Runtime that turns observations into runs and drives each run's Session to a terminal outcome. One claim from `ctx.duties` admits exactly one run; everything after the claim is this service's own machine.

```ts cordis-catalog
/**
 * Start one run by hand, bypassing the trigger seam.
 * @param dutyId - The Duty to run.
 * @param cause - Why a human or model asked for this run.
 * @param options - `wait` resolves only after the run settles, so a
 * foreground caller observes the outcome rather than just the admission.
 * @returns the started run.
 */
async startRun(dutyId: DutyId, cause: DutyRunCause, options: { readonly wait?: boolean } = {}): Promise<DutyRun>
```

Source: [`packages/duty/duty-runner/src/index.ts:157`](../../packages/duty/duty-runner/src/index.ts)

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

Source: [`packages/duty/duty/src/index.ts:84`](../../packages/duty/duty/src/index.ts)

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

## 配置

| 包 | 键 | 含义 |
|---|---|---|
| `dsh-duty` | `defaultMaxConsecutiveFailures` | 1–20;连续失败多少次后 Duty 自行暂停 |
| `dsh-duty` | `runHistoryLimit`、`triggerEventLimit` | 每个 Duty 的 run 记录与触发审计事件保留数 |
| `dsh-duty-trigger` | `pollIntervalMs` | 1000–60000;两次 sweep 启动之间的毫秒数 |
| `dsh-duty-runner` | `subagentProvider` | `parallel` 扇出所用的 subagent provider;默认 `fork` |
| `dsh-duty-runner` | `tokenPriceUsdPerMillion` | 每百万 token 的综合美元价格;`0` 关闭成本核算 |
| `dsh-duty-runner` | `maxRepairs` | 0–5;agent 步骤在首次尝试之后的修复次数 |
