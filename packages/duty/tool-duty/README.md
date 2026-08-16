# @deepseek-ai/dsh-tool-duty

English | [中文](README.zh.md)

Model-facing Duty tools: `duty_list`, `duty_create`, `duty_set_lifecycle`, `duty_start`, and `duty_answer`. They are the model-visible surface over the durable Duty domain and the run runtime; all validation and lifecycle rules stay in `@deepseek-ai/dsh-duty`.

The package has no configuration. It injects `duties`; the run runtime is optional and resolved through `ctx.get('dutyRunner')`, so `duty_start` reports a missing runtime instead of loading one.

## Tools

| Tool | Effect |
|---|---|
| `duty_list` | Lists every Duty with lifecycle, run count, running flag, and latest outcome. |
| `duty_create` | Creates one Draft Duty from a complete contract; the Host validates it. |
| `duty_set_lifecycle` | Moves a Duty between draft, active, paused, and archived; pausing requires a reason. |
| `duty_start` | Wakes one active Duty by hand through the run runtime; returns the run id. |
| `duty_answer` | Settles one open human decision, unblocking its parked run. |

Failures return `{ ok: false, error }` (plus `code` for `DutyError` cases) rather than throwing, so the model can read the reason and retry.

## Model Experience

### Duty tool results

#### What the model sees

Tool results are compact JSON summaries of the durable records, never the full contracts. `duty_create` returns only the new id and mode; list results carry state, not body steps.

#### Token effect

Bounded per call: results are small summaries, and no Duty body is echoed back by any tool in this package.

#### KV Cache effect

Independent. Duty tool calls do not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **No edit or removal tool** — `duty_edit` and removal are not exposed to the model yet; only creation, lifecycle, wake, and answer are.
- **No human-inbox read tool** — a model cannot enumerate open human requests; answering requires an id obtained out of band.
- **`duty_start` depends on the optional run runtime** — without `@deepseek-ai/dsh-duty-runner` the tool reports a load error instead of executing.
