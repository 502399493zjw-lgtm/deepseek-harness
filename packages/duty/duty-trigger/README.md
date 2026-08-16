# @deepseek-ai/dsh-duty-trigger

English | [中文](README.zh.md)

The Duty waking-source seam: `ctx.dutyTriggers` registers trigger providers and sweeps them on a fixed cadence, publishing their observations as `duty/trigger` events. Providers own due-math over durable Duty state; the run runtime (a separate Consumer) owns claim, dedupe, and execution. The registry owns only timing and failure containment.

Public types are exported from the package root and `@deepseek-ai/dsh-duty-trigger/types`; [`src/types.ts`](src/types.ts) is their source.

## Configuration

| key | meaning |
|---|---|
| `pollIntervalMs` | Required whole milliseconds 1000–60000 between sweep starts. |

```yaml
- id: duty-trigger
  name: '@deepseek-ai/dsh-duty-trigger'
  config:
    pollIntervalMs: 30000
```

The upper bound exists so a calendar trigger matching a whole minute can never fall between two sweeps: at most one minute elapses per sweep, and a matching minute stays due for its full duration.

## Providers and sweeps

A provider implements {@link DutyTriggerProvider}: a stable unique `id` and a `poll(now)` returning only due {@link DutyTriggerObservation}s. Registering a duplicate id throws; {@link DutyTriggerService.registerProvider} returns the disposer, so provider plugins register through `ctx.effect()` and unregister on fiber disposal.

One sweep polls every provider once at the current wall clock and emits each returned observation as a `duty/trigger` event. Sweeps never overlap: the next timer arms only after the current sweep settles, re-reading the clock each wake instead of accumulating drift. A provider whose poll throws is logged and skipped; it cannot stall the sweep or hide another provider's due work. Concurrent {@link DutyTriggerService.sweep} callers share the one in-flight sweep.

An observation is a candidate, not a decision: the Consumer validates it against the Duty domain and either claims a run or records why it skipped.

## Model Experience

### Local trigger registry state

#### What the model sees

Nothing. `ctx.dutyTriggers` registers no tool, prompt section, model-facing context, or Session event; observations reach a model only when a Consumer turns them into a run's Session.

#### Token effect

Zero. No observation, provider id, or sweep result enters a model request.

#### KV Cache effect

Independent. Sweeps do not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **No observation persistence here** — the registry holds observations only for the duration of an emit; the Consumer decides what to record durably (run records and trigger audit live in the `duty` domain).
- **No per-provider cadence** — all providers share the one registry sweep interval; a provider needing finer timing must do its own internal segmentation.
- **Single-process sweeps** — two Host processes running the registry would both poll and both report; the run runtime's single-run claim absorbs the duplicate rather than the registry deduplicating.
