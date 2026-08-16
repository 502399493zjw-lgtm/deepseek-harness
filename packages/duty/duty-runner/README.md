# @deepseek-ai/dsh-duty-runner

English | [中文](README.zh.md)

The Duty run runtime: turns a `duty/trigger` observation or a manual start into one major-trigger run, drives the stored execution body as agent turns and subagent fan-out, parks on durable human decisions, and settles the run under the Duty's failure, budget, and cursor policy.

The run's Session log is the machine's only authority. Every state change is a session event (`duty/run-bound`, `duty/step`, `duty/human-wait`, `duty/human-answer`, `duty/run-finish`), and the machine state is refolded from the log at every idle boundary and after every cold resume — there is no process-local cursor.

## Configuration

| key | meaning |
|---|---|
| `subagentProvider` | Subagent provider used for `parallel` fan-out; defaults to `fork`. |
| `tokenPriceUsdPerMillion` | Required blended USD price per million tokens for run cost attribution; `0` disables cost accounting. |
| `maxRepairs` | Repairs per agent step after the first attempt, 0–5; defaults to 2. |

```yaml
- id: duty-runner
  name: '@deepseek-ai/dsh-duty-runner'
  config:
    subagentProvider: fork
    tokenPriceUsdPerMillion: 2.0
    maxRepairs: 2
```

The service injects `duties`, `agents`, `sessions`, `subagents`, and `sessionPersistence`.

## Run lifecycle

1. **Claim.** A trigger observation or {@link DutyRunnerService.startRun} claims the Duty's single-run slot under a freshly minted Session id. A skipped claim is recorded in the trigger audit; a manual start on an unrunnable Duty rejects with `duty-not-runnable`.
2. **World.** The run's Agent is created with its scoped world narrowed to `toolPolicy.allow` via `tools.restrict`, its gated tools denied by a `tools.guard`, and three run-scoped tools registered: `duty_adapt_body` (structural adaptation), `duty_step_done` (completion marking), and `duty_request_human` (durable human questions).
3. **Kickoff.** The first model-visible message is the Chinese kickoff naming the trigger cause, followed by the first step instruction. A step completes only when the model calls `duty_step_done`; a step that never reports is repaired up to `maxRepairs` and then fails the run.
4. **Body.** `agent` steps run as turns on the run's Agent; `phase` steps recurse in order; `parallel` steps fan their children out through the subagent seam and complete only when every child stops with `completed`.
5. **Verify.** With `verification: 'on'`, a reported step completion goes through the configured `ctx.dutyVerifiers` checker over the step's evidence window; each verdict is recorded as `duty/verdict`, a failed verdict sends the step back through repair, and a missing verifier fails the run loudly.
6. **Park and resume.** `duty_request_human` creates a durable {@link HumanRequest}, appends `duty/human-wait`, and settles the run as `waiting_for_human` with the claim held. When the answer commits, `dsh-duty` emits `duty/human-answered`; the runner resumes the same Session, appends `duty/human-answer`, and continues from the fold. A parked run survives a process restart: boot reconciliation re-arms it and cold-resumes interrupted runs by refolding their persisted logs.
6. **Settle.** The cursor advances only on success. Run cost is the sum of the Session's `assistant/message` usage priced by `tokenPriceUsdPerMillion`; exceeding `limits.budgetUsd` fails the run and pauses the Duty on `budget` regardless of the failure count. Consecutive failures pause on `failures` per `limits.maxConsecutiveFailures`.

## Model Experience

### Run-scoped tools and prompts

#### What the model sees

Per step, one host-injected user message naming the step label and prompt and requiring a `duty_step_done` report. Three run-scoped tools (`duty_adapt_body`, `duty_step_done`, `duty_request_human`) exist only on the run's Agent. The kickoff, instructions, tool results, and the resumed human answer are all session events, so everything model-visible is logged.

#### Token effect

One instruction block per step attempt plus the model's own work. Parallel children run in separate subagent Sessions and consume their own tokens, not the run Agent's context.

#### KV Cache effect

Append-only within the run's Session: each attempt extends the conversation after its reusable prefix. Subagent children have independent request prefixes.

## Known Limitations and Deferred Work

- **Verification is opt-in** — a Duty with `verification: 'off'` (the default) accepts the model's own `duty_step_done` report; `'on'` consults the `ctx.dutyVerifiers` seam, whose evaluator provider judges the evidence window, and a failed verdict repairs the step.
- **No cross-process single-run guarantee** — the claim serializes through one Host process's domain write chain; two Host processes running the runner both poll and one loses the claim race by a skip record.
- **Adaptation is model-authored** — `duty_adapt_body` validates the adapted body against the durable schema, but no diff review against the stored body is enforced before execution.
- **Budget pricing is a single blended rate** — per-provider or per-model pricing is deferred; runs attribute cost under one configured USD-per-million-token price.
- **Teardown parks rather than settles** — unloading the runner disposes live run Agents without settling; the next boot's reconciliation cold-resumes or fails them.
