# @deepseek-ai/dsh-duty-verify

English | [中文](README.zh.md)

The independent step-completion verification seam: `ctx.dutyVerifiers` registers completion checkers and resolves the configured one. The run runtime consults it after `duty_step_done` when a Duty's contract opts in with `verification: 'on'`; a failed verdict sends the step back through the repair loop, and a missing verifier fails loud instead of passing silently.

Public types are exported from the package root and `@deepseek-ai/dsh-duty-verify/types`; [`src/types.ts`](src/types.ts) is their source.

## Configuration

| key | meaning |
|---|---|
| `verifier` | Required: the verifier id the registry selects for verification requests. |

```yaml
- id: duty-verify
  name: '@deepseek-ai/dsh-duty-verify'
  config:
    verifier: evaluator
```

## Verdicts

A {@link DutyVerifier} receives the step, the model's one-line completion summary, and a bounded evidence bundle the runtime rendered from the run Session; verifiers never read the log themselves, so the request is the whole input surface. Infrastructure failures throw and the runtime treats them as a failed verification — never a silent pass. A Duty selects a verifier through its `verification` field: `on` uses the configured default, a non-empty string names a specific registered id.

## Model Experience

### Local verification registry state

#### What the model sees

Nothing. The registry registers no tool, prompt section, model-facing context, or Session event. Its verdicts reach the model only through the run runtime's repair loop, which records each verdict as a `duty/verdict` session event.

#### Token effect

Zero for the registry itself; a verifier's own model usage belongs to the verifier.

#### KV Cache effect

Independent. The registry does not touch a model request prefix.

## Known Limitations and Deferred Work

- **No verdict appeals or re-check policy** — a failed verdict only sends the step back through repair; there is no human appeal surface yet.
