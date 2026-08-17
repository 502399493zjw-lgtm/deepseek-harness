# @deepseek-ai/dsh-duty-trigger-timer

English | [中文](README.zh.md)

The timer waking-source provider: registers id `timer` with `ctx.dutyTriggers` and reports every active, unclaimed standing Duty whose interval or cron occurrence has arrived. It reads only durable Duty state, so a Duty wakes whether or not any Session or agent for it is live.

## Waking-rule math

Rule math lives in [`src/domain.ts`](src/domain.ts) as pure deterministic functions; production reads the platform wall clock, tests supply explicit instants.

- **Interval** occurrences sit on a grid anchored to creation: `createdAt + k·everyMs` for `k ≥ 1`, so the first wake is one period after creation. A Duty that slept through three periods wakes once for the most recent elapsed occurrence — never once per missed period — and `nextWakeAt` always advances past the current instant.
- **Cron** expressions are five numeric fields (minute, hour, day of month, month, day of week; 0 and 7 both mean Sunday) with `*`, ranges, lists, and steps. Day matching follows the common OR semantics: both restricted day fields must admit the day, or the one restricted field when only it is restricted. A matching minute stays due for its whole minute, so the registry's sub-minute sweep cadence cannot skip it; missed matching minutes advance without replay. The search horizon is {@link CRON_SEARCH_HORIZON_DAYS} days (eight years, covering the exceptional 2096-to-2104 leap-day gap across a non-leap century); an unsatisfiable rule such as February 30 reports no occurrence. A syntactically invalid rule, which the contract schema rejects at write time, is warned about and skipped as defense against a hand-edited durable medium.
- **Cron timezone** — a cron trigger may carry an IANA timezone name; omitted means UTC. Zone matching reads every candidate minute through `Intl.DateTimeFormat`, so half-hour and three-quarter-hour offsets fire at their exact local minute boundary, and daylight-saving transitions shift the wake with the offset: the spring-forward gap simply has no 02:30, and a repeated hour on fall-back day fires once per UTC pass, as Vixie cron does. Day-of-month and day-of-week fields follow the zone's local calendar, including weekdays that begin before the corresponding UTC midnight.

## Polling

One poll reads `ctx.duties.list()` once and skips every Duty that is not a standing one with an `interval` or `cron` trigger, is not `active`, is `running`, or whose stored `nextWakeAt` lies in the future. Each due Duty yields one observation carrying its trigger description as the cause, and its computed `nextWakeAt`; the run runtime stores that value so a restart keeps the schedule anchored.

## Model Experience

### Local timer state

#### What the model sees

Nothing. The provider registers no tool, prompt section, model-facing context, or Session event; its `DutyTriggerObservation`s reach a model only when the run runtime turns them into a run's Session.

#### Token effect

Zero. No observation, rule evaluation, or warning enters a model request.

#### KV Cache effect

Independent. Polls do not touch a model request prefix and cannot invalidate an otherwise reusable provider cache entry.

## Known Limitations and Deferred Work

- **One shared cadence** — the provider is polled at the registry's single `pollIntervalMs`; it does not arm its own timers.
- **Pre-first-fire rescans** — until a cron Duty emits its first due observation, each sweep recomputes the future occurrence; after that observation stores durable `nextWakeAt`, the provider skips directly to the next match. A provider-local cache or a Duty-domain scheduling operation is deferred.
- **Hand-rolled five-field cron** — the numeric subset is implemented locally because the tree has no maintained parser and the needed operation is "next match at or after an instant"; swap for a maintained library if range semantics ever need to grow beyond this subset.
