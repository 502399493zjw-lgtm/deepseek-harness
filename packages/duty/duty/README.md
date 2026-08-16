# @deepseek-ai/dsh-duty

English | [中文](README.zh.md)

Durable responsibility contracts for the DeepSeek Harness. The package registers `ctx.duties`, persists the `duty` storage domain, and owns the closed vocabulary of {@link DutySpec}, {@link DutyState}, {@link DutyRun}, and {@link HumanRequest}. It is the record layer of the Duty capability: the runtime that turns a major trigger into a run and the UI that renders it live in separate packages.

Public types are exported from the package root and `@deepseek-ai/dsh-duty/types`; [`src/types.ts`](src/types.ts) is their source. The durable schemas and their whole-body bounds live in [`src/spec.ts`](src/spec.ts).

## Configuration

| key | meaning |
|---|---|
| `defaultMaxConsecutiveFailures` | Required integer 1–20: consecutive failed runs tolerated before a Duty pauses itself. |
| `runHistoryLimit` | Required positive integer: run records retained per Duty, newest first. |
| `triggerEventLimit` | Required positive integer: trigger audit events retained per Duty. |

```yaml
- id: duty
  name: '@deepseek-ai/dsh-duty'
  config:
    defaultMaxConsecutiveFailures: 3
    runHistoryLimit: 50
    triggerEventLimit: 50
```

The service injects `storageDomain`. Its durable domain is `duty`, with one table per concern: `specs`, `state`, `runs`, `human_requests`, and `trigger_events`, each keyed by `DutyId`.

## Data, lifecycle, and durability

A Duty states what should happen and when. One major trigger creates exactly one {@link DutyRun}, and that run owns one Session for its whole life: retries, repairs, and human answers continue that Session rather than starting new runs. Durable Duty data therefore lives in the `duty` domain, never in a Session log, because it must outlive every Session it creates.

`create` builds the contract from the request, deriving `mode` and defaulting `verification` to `off` (`once` for a manual trigger, `standing` otherwise), then validates it against the durable schema and stores it in `draft`. `edit` replaces named fields under compare-and-set against the opaque `version` token and revalidates the merged contract, so an edit cannot store a contract the schema would reject on reopen. `setLifecycle` moves a Duty between `draft`, `active`, `paused`, and `archived`; entering `paused` records the reason, leaving it drops the reason.

`claim` holds the Duty's single-run slot and allocates the next run number inside one domain write-chain transform, so two triggers arriving together cannot both start a run or receive the same index. It refuses with `paused`, `archived`, `running`, or `draft` as the trigger's `skippedReason`. `settle` writes the final run record and applies policy: the cursor advances only on success, the failure count resets on success and pauses the Duty after `limits.maxConsecutiveFailures` consecutive failures, an explicit `pause` (for example `budget`) pauses immediately regardless of the count, and `waiting_for_human` keeps the claim because the same run resumes once answered.

`ask` opens a durable {@link HumanRequest} bound to the run's Session; `answer` settles it, enforcing the offered options unless `allowFreeform`, and rejects a settled request twice. `recordTrigger` keeps a bounded audit of every waking decision, including the reason a wakeup did not run.

Every mutation that must not interleave runs through the domain write chain. Records are validated against the zod schemas at both the service boundary and the durable boundary, so a hand-edited medium fails loud instead of producing a Duty that wakes with a meaningless contract.

## Contract bounds

The schemas in `src/spec.ts` enforce the execution-body limits and the trigger vocabulary: at most 30 steps, depth 5, parallel fan-out 8, per-run budget ≤ USD 20, interval periods of at least one minute, five-field numeric cron expressions, gated tools drawn from the allowance, an agent step with a prompt and no children, and a group step with children. A contract violating any of these fails `create` and `edit` with `DutyError('invalid-contract')`.

## Service errors

`DutyError` carries a stable `code` among `duty-not-found`, `run-not-found`, `human-request-not-found`, `version-conflict`, `duty-running`, `duty-not-runnable`, `request-already-settled`, `answer-not-offered`, `invalid-contract`, and `domain-not-open`. Operational storage faults reject as themselves rather than being mislabeled as business errors.

## Model Experience

### Local duty state

#### What the model sees

Nothing. `ctx.duties` registers no tool, prompt section, model-facing context, or Session event. A Duty contract reaches a model only through a separately documented Consumer (for example a tool or slash command that reads and writes it), and a run's transcript reaches a model only as that run's Session.

#### Token effect

Zero. No contract, state, run record, or human decision from this package enters a model request.

#### KV Cache effect

Independent. Listing or mutating duty records does not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **Nothing executes here** — this package is the record layer only. The run runtime, trigger sweep, tool and command Consumers, and UI live in the sibling duty packages.
- **Human decisions have no deadline or reminder** — an open request stays open indefinitely; time-based expiry and re-ask are deferred to the trigger/runtime layer.
- **No cross-process conditional write** — the claim serializes through one service instance's domain write chain; multiple Host processes writing one storage root rely on the storage backend's own single-writer model.
- **No Duty deletion cascade** — `remove` deletes Duty-owned records but the run Sessions they created remain; Session history deletion is owned by Session persistence, which has no deletion API yet.
