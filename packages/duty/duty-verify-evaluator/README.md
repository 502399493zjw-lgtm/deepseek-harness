# @deepseek-ai/dsh-duty-verify-evaluator

English | [中文](README.zh.md)

The evaluator verifier: judges a reported step completion with a one-shot subagent over the bounded evidence bundle, returning a structured verdict (`pass`/`reason`) — never prose-sniffed.

## Configuration

| key | meaning |
|---|---|
| `subagentProvider` | Subagent provider for the evaluation child; defaults to `fork`. |
| `maxEvidenceChars` | Required integer ≥ 1000: UTF-16 char bound on the rendered evidence block. |

```yaml
- id: duty-verify-evaluator
  name: '@deepseek-ai/dsh-duty-verify-evaluator'
  config:
    subagentProvider: fork
    maxEvidenceChars: 12000
```

The plugin registers verifier id `evaluator` with `ctx.dutyVerifiers` and injects `dutyVerifiers` and `subagents`.

## Verdict flow

One verification spawns one one-shot child with the Chinese evaluation instruction (step label, step goal, the model's self-reported summary, and the evidence lines) and an output schema for `{ pass, reason }`. A child that stops without a valid structured verdict resolves to a failed verification with a reason, so the run runtime repairs rather than advancing.

## Model Experience

### Evaluation child prompt

#### What the model sees

One child instruction naming the step label and goal, the self-reported summary, and the evidence lines, ending in the structured `{ pass, reason }` output schema. The child's verdict is the run runtime's only input; the child's own transcript stays in its own Session.

#### Token effect

One instruction block plus the evidence bundle per verification, in a separate child Session — not the run Agent's context.

#### KV Cache effect

Independent: each evaluation child has its own request prefix.

## Known Limitations and Deferred Work

- **Evidence is the rendered window, not the raw log** — the runtime bounds and renders the evidence lines; the evaluator cannot request more context.
- **Single pass** — a failed verdict repairs the step but does not re-invoke a deeper re-check policy.
