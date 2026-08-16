# @deepseek-ai/dsh-command-duty

English | [中文](README.zh.md)

Human-facing Duty commands. `/duty` lists Duties and wakes one by hand; `/loop` asks the model to draft a Duty contract from the current transcript and create it with `duty_create`.

The package has no configuration. It injects `commands` and `duties`; the run runtime is optional and resolved through `ctx.get('dutyRunner')`, so `/duty start` reports a missing runtime instead of loading one.

## Commands

| Command | Effect |
|---|---|
| `/duty` or `/duty list` | Lists every Duty with id, lifecycle, title, and latest outcome. |
| `/duty start <dutyId> <原因>` | Wakes one active Duty by hand and reports the run id. |
| `/loop <触发方式描述>` | Queues a model instruction to draft a Duty contract from the transcript and create a Draft via `duty_create`; requires `@deepseek-ai/dsh-tool-duty`. |

## Model Experience

### Loop drafting instruction

#### What the model sees

One user message instructing it to extract goal, scope, trigger, body, tool policy, and escalation from the current transcript and to create a Draft with `duty_create` — never to activate it. The message is a session event, so the drafted contract is logged.

#### Token effect

One fixed instruction block per `/loop` invocation plus the model's own drafting work.

#### KV Cache effect

Append-only: the instruction extends the existing conversation after its reusable prefix.

## Known Limitations and Deferred Work

- **`/loop` depends on `@deepseek-ai/dsh-tool-duty`** — without it the model cannot create the draft and reports the missing tool.
- **No duty deletion or history commands** — the command surface covers list and start only; edit, pause, archive, and run history remain tool or UI concerns.
