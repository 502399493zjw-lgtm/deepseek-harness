# Agent Note: Duty capability — durable responsibilities, major-trigger runs, and human inbox

Status: implemented

English | [中文](2026-08-16-duty-capability.zh.md)

## Problem

A survey of the dittos loop product against the DeepSeek Harness found four capability gaps: no cold-session resident triggering, no independent verification, no durable absent-user human adjudication, and no runtime tying the three together. Everything else in a "loop flow" product — session log, agents, tools, subagents, goals, storage domains, session projections — already exists as reusable DSH capability. A loop flow is a durable responsibility: a contract stating what should happen, when, with which tools, and how results are reported, plus one user-visible run per major trigger whose whole process lives in one Session.

## Decision

The capability ships as the first-party `packages/duty/*` group (`@deepseek-ai/dsh-duty*`; the UI layer still calls the product concept a "loop flow"):

- **`dsh-duty`** owns the durable record layer in the `duty` storage domain: `specs`, `state`, `runs`, `human_requests`, and `trigger_events` tables keyed by `DutyId`. One trigger admits exactly one `DutyRun` through a claim inside the domain write chain (dittos' `claimRun` was a non-atomic read-then-write). The cursor advances only on run completion; N consecutive failures (default 3) pause on `failures`; an explicit `budget` pause applies immediately regardless of the count. `ask`/`answer` implement the durable human inbox with option-or-freeform validation, and `answer` emits `duty/human-answered` only after the durable settle.
- **`dsh-duty-trigger`** is the waking-source seam: a registry that sweeps registered providers on a configured sub-minute cadence and publishes their observations as `duty/trigger` events. Sweeps never overlap and re-read the wall clock at every wake, borrowing the schedule package's clock disciplines.
- **`dsh-duty-trigger-timer`** registers provider `timer` for `interval` and `cron` Duties. Interval occurrences sit on a grid anchored to creation; cron is the five-field numeric subset with Vixie OR day semantics, hand-rolled because the tree has no maintained parser and the needed operation is "next match at or after an instant". Missed occurrences advance without replay, so a Duty wakes once for the most recent elapsed occurrence. The registry's `pollIntervalMs` ceiling (≤ 60 s) prevents a whole-minute cron match from falling between two sweeps.
- **`dsh-duty-runner`** is the runtime: on an observation or a manual start it claims, creates the run's Session and Agent with tools narrowed to `toolPolicy.allow` by `tools.restrict` and gated tools denied by `tools.guard`, and drives the body. The Session log is the machine's only authority: `duty/run-bound`, `duty/step`, `duty/human-wait`, `duty/human-answer`, and `duty/run-finish` events fold into the machine state, so a parked run resumes after a restart by refolding the persisted log. Agent steps complete only when the model calls the run-scoped `duty_step_done`; a step that never reports is repaired up to `maxRepairs` and then fails the run. `parallel` steps fan out through `ctx.subagents`. The kickoff is the Chinese `开始执行你的 loop flow。本次触发原因:${reason}。` line, kept verbatim. Run cost is the Session's summed `assistant/message` usage priced by the configured blended `tokenPriceUsdPerMillion`; exceeding `limits.budgetUsd` fails the run and pauses on `budget`.
- **`dsh-tool-duty`** exposes `duty_list`, `duty_create`, `duty_set_lifecycle`, `duty_start`, and `duty_answer` to models; **`dsh-command-duty`** registers `/duty` and `/loop`, where `/loop` queues a model instruction to draft a Duty contract from the current transcript.
- **`dsh-duty-verify`** is the independent completion-verification seam (`ctx.dutyVerifiers`, one configured default verifier id), and **`dsh-duty-verify-evaluator`** registers verifier `evaluator`: one one-shot subagent per reported step completion over the runtime-rendered evidence window, returning a structured `{ pass, reason }` verdict. A Duty opts in through `verification` (`off`, `on` for the configured default, or a named registered verifier id); the runner records every verdict as `duty/verdict`, repairs on a failed verdict, and fails the run loudly when the selected verifier is missing. The evaluator's Chinese instruction is pinned by the duty snapshot.

Hardness layering follows the plan: capability enforcement is the hard layer (tool restriction and gating are executed by the Agent's scoped world, not by prompts), action guidance stays soft, and there is no learned memory layer in Phase 1. The execution body is structured data validated at the contract boundary (`MAX_BODY_STEPS` 30, depth 5, `MAX_PARALLEL_WIDTH` 8, budget ≤ 20 USD, gated ⊆ allow, agent steps with prompts); there is no rendered `flow.js` to drift from the executed plan, and `duty_adapt_body` records adaptations structurally in the run log.

## Alternatives considered

- **dittos' `flow.js` and `claude -p` executor**: rejected — rendered-for-humans source text that is never executed is a cognition trap, and the subprocess executor duplicates DSH's agent loop.
- **Attempt ≈ goal round via `dsh-goal-round-driver`**: rejected — the driver runs a uniform round loop, while a Duty body is a structured step machine with `parallel` fan-out and human parking; the runner implements its own idle checkpoint (`whenIdle`), flush barrier (`sessions.flush`), and repair loop, and documents the divergence.
- **External plugin package**: rejected — the trigger seam, human inbox, and run runtime must touch session, domain, tool, and agent layers, which first-party packages own.
- **dittos' `.data/*.json` raw storage and hand-rolled HTTP routing**: rejected — storage domains and the existing web/Remote stack own those concerns.
- **dittos' substring escalation matching**: rejected — escalation is structured data on the contract, not text sniffing.

## Consequences

- The runner parks on human answers and cold-resumes interrupted runs from the persisted log; boot reconciliation re-arms parked runs and fails unresumable ones.
- The trigger registry and timer provider are process-local projections; a second Host process duplicates sweeps, and the single-run claim turns the duplicate into a skip record.
- Shipped after the first commit: the Typert Host Remote contract on `DutyService`, the `duty` session projection, `ui-duty`, the runnable example with its keyless snapshot, and the verification seam with the evaluator provider.
- Deferred to later iterations: per-provider token pricing, cron timezones, per-Duty verifier selection, and a human appeal surface for failed verdicts.
- The `duty/step` and sibling session events are typed on `SessionEventMap` without `ignorable`, so sessions containing them require the duty-runner package (or its types) to be read; duty profiles always load it.
