/**
 * Pure waking-rule math for the timer trigger provider: when an interval Duty
 * next occurs, and when a five-field numeric cron expression next matches.
 * All functions are deterministic in their inputs; production reads the
 * platform wall clock, tests supply explicit instants.
 * @module @deepseek-ai/dsh-duty-trigger-timer/src/domain
 */

/**
 * Longest calendar search horizon in whole days. Four years cover every leap
 * day; a cron expression that matches no minute inside it (for example
 * February 30) can never wake a Duty and reports no occurrence.
 */
export const CRON_SEARCH_HORIZON_DAYS = 1461

const MILLIS_PER_MINUTE = 60_000
const MILLIS_PER_HOUR = 3_600_000
const MILLIS_PER_DAY = 86_400_000

/** Inclusive bounds per cron field, in expression order. */
const FIELD_BOUNDS = [
  { min: 0, max: 59 },   // minute
  { min: 0, max: 23 },   // hour
  { min: 1, max: 31 },   // day of month
  { min: 1, max: 12 },   // month
  { min: 0, max: 7 },    // day of week; 0 and 7 both mean Sunday
] as const

/** A cron expression that is syntactically invalid or names out-of-range values. */
export class CronRuleError extends Error {
  /**
   * Build one invalid-rule failure.
   * @param message - What the expression violates.
   */
  constructor(message: string) {
    super(message)
    this.name = 'CronRuleError'
  }
}

/** One parsed cron rule as value sets plus which day fields were restricted. */
export interface CronRule {
  readonly minute: ReadonlySet<number>
  readonly hour: ReadonlySet<number>
  readonly dom: ReadonlySet<number>
  readonly month: ReadonlySet<number>
  readonly dow: ReadonlySet<number>
  readonly domRestricted: boolean
  readonly dowRestricted: boolean
}

/**
 * Expand one cron field's components into the set of values it names.
 * @param field - Raw field text: `*`, values, ranges, steps, and lists.
 * @param min - Inclusive lower bound of the field.
 * @param max - Inclusive upper bound of the field.
 * @returns the expanded value set.
 */
function expandField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>()
  for (const component of field.split(',')) {
    const parts = component.split('/')
    const base = parts[0] ?? ''
    const stepText = parts[1]
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isSafeInteger(step) || step < 1) {
      throw new CronRuleError(`cron step must be a positive integer in '${field}'`)
    }
    let start: number
    let end: number
    if (base === '*') {
      start = min
      end = max
    } else {
      const range = base.split('-')
      start = Number(range[0])
      end = range[1] === undefined ? start : Number(range[1])
    }
    if (start < min || start > max || end < min || end > max) {
      throw new CronRuleError(`cron value outside ${min}-${max} in '${field}'`)
    }
    if (end < start) {
      throw new CronRuleError(`cron range descends in '${field}'`)
    }
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

/**
 * Parse one five-field numeric cron expression.
 * @param expr - Five space-separated fields: minute, hour, day of month,
 * month, day of week (0 or 7 means Sunday).
 * @returns the parsed rule; day matching follows the common OR semantics: a
 * day matches when both restricted fields allow it, or one of them when only
 * that one is restricted, or every day when neither is.
 */
export function parseCron(expr: string): CronRule {
  const fields = expr.trim().split(/\s+/u)
  if (fields.length !== 5) {
    throw new CronRuleError(`cron expression '${expr}' must have five fields`)
  }
  const expandAt = (index: number): Set<number> => {
    const bounds = FIELD_BOUNDS[index]
    if (bounds === undefined) throw new CronRuleError(`cron field ${index} has no bounds`)
    const field = fields[index]
    if (field === undefined) throw new CronRuleError(`cron expression '${expr}' must have five fields`)
    return expandField(field, bounds.min, bounds.max)
  }
  const minute = expandAt(0)
  const hour = expandAt(1)
  const dom = expandAt(2)
  const month = expandAt(3)
  const dow = expandAt(4)
  // Sunday is writable as both 0 and 7; normalize so one set holds it.
  if (dow.has(7)) {
    dow.delete(7)
    dow.add(0)
  }
  return {
    minute,
    hour,
    dom,
    month,
    dow,
    domRestricted: fields[2] !== '*',
    dowRestricted: fields[4] !== '*',
  }
}

/** Whether one calendar day is admitted by the parsed rule. */
function dayMatches(rule: CronRule, month: number, dom: number, dow: number): boolean {
  const domMatch = rule.month.has(month) && rule.dom.has(dom)
  const dowMatch = rule.month.has(month) && rule.dow.has(dow)
  if (rule.domRestricted && rule.dowRestricted) return domMatch || dowMatch
  if (rule.domRestricted) return domMatch
  if (rule.dowRestricted) return dowMatch
  return rule.month.has(month)
}

/**
 * Find the first minute-aligned match at or after the start of the minute
 * holding `from`.
 * @param expr - Five-field numeric cron expression.
 * @param from - Any epoch-millisecond instant.
 * @returns the matching minute start in epoch milliseconds, or `undefined`
 * when no minute matches within {@link CRON_SEARCH_HORIZON_DAYS}.
 */
export function nextCronMatch(expr: string, from: number): number | undefined {
  const rule = parseCron(expr)
  const current = new Date(from)
  const currentDay = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate())
  for (let dayOffset = 0; dayOffset <= CRON_SEARCH_HORIZON_DAYS; dayOffset += 1) {
    const dayStart = currentDay + dayOffset * MILLIS_PER_DAY
    const date = new Date(dayStart)
    if (!dayMatches(rule, date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCDay())) continue
    const firstHour = dayOffset === 0 ? current.getUTCHours() : 0
    for (let hour = firstHour; hour <= 23; hour += 1) {
      if (!rule.hour.has(hour)) continue
      const firstMinute = dayOffset === 0 && hour === current.getUTCHours()
        ? current.getUTCMinutes()
        : 0
      for (let minute = firstMinute; minute <= 59; minute += 1) {
        if (!rule.minute.has(minute)) continue
        return dayStart + hour * MILLIS_PER_HOUR + minute * MILLIS_PER_MINUTE
      }
    }
  }
  return undefined
}

/** One resolved waking occurrence and what it means for the current sweep. */
export interface IntervalOccurrence {
  /** The occurrence's grid point in epoch milliseconds. */
  readonly occurrenceAt: number
  /** Whether that occurrence has arrived: it lies at or before `now`. */
  readonly due: boolean
  /** The next grid point after this occurrence, in epoch milliseconds. */
  readonly nextWakeAt: number
}

/**
 * Resolve the fixed-rate occurrence for one interval Duty at one instant.
 *
 * Occurrences sit on a grid anchored to creation: `createdAt + k * everyMs`
 * for `k >= 1`, so the first wake is one period after creation. An occurrence
 * in the past is due exactly once: a Duty that slept through three periods
 * wakes once for the most recent elapsed occurrence, never once per missed
 * period, and `nextWakeAt` always advances past the current instant.
 * @param createdAt - Duty creation time in epoch milliseconds.
 * @param everyMs - The fixed period in milliseconds.
 * @param now - The current wall-clock instant in epoch milliseconds.
 * @returns the resolved occurrence.
 */
export function resolveIntervalOccurrence(
  createdAt: number,
  everyMs: number,
  now: number,
): IntervalOccurrence {
  // Floor selects the most recent elapsed grid point: at 03:20 the 03:00
  // occurrence is the due one, and a period boundary counts as its own point.
  const index = Math.max(1, Math.floor((now - createdAt) / everyMs))
  const occurrenceAt = createdAt + index * everyMs
  return { occurrenceAt, due: occurrenceAt <= now, nextWakeAt: occurrenceAt + everyMs }
}

/** One resolved calendar occurrence and what it means for the current sweep. */
export interface CronOccurrence {
  /** Whether `now` falls inside a matching minute. */
  readonly due: boolean
  /** The matching minute start; absent when no minute matches the horizon. */
  readonly occurrenceAt?: number
  /** The next matching minute after this occurrence, when one exists. */
  readonly nextWakeAt?: number
}

/**
 * Resolve the calendar occurrence for one cron Duty at one instant.
 *
 * A matching minute is due during its whole minute, so a sweep anywhere inside
 * it wakes the Duty. A Duty that slept through several matching minutes wakes
 * for the current one only: the search starts at the minute holding `now`,
 * which advances past all missed matches without replaying them.
 * @param expr - Five-field numeric cron expression.
 * @param now - The current wall-clock instant in epoch milliseconds.
 * @returns the resolved occurrence; `nextWakeAt` is absent when no further
 * minute matches within the search horizon.
 */
export function resolveCronOccurrence(expr: string, now: number): CronOccurrence {
  const occurrenceAt = nextCronMatch(expr, now)
  if (occurrenceAt === undefined) return { due: false }
  const next = nextCronMatch(expr, occurrenceAt + MILLIS_PER_MINUTE)
  return {
    occurrenceAt,
    due: occurrenceAt <= now,
    ...(next === undefined ? {} : { nextWakeAt: next }),
  }
}
