import { describe, expect, it } from 'vitest'
import {
  CronRuleError,
  nextCronMatch,
  parseCron,
  resolveCronOccurrence,
  resolveIntervalOccurrence,
} from '../src/domain.ts'

/** Build an epoch-millisecond instant from UTC parts. */
const at = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number => Date.UTC(year, month - 1, day, hour, minute, second)

describe('interval occurrences', () => {
  const createdAt = at(2026, 1, 1, 0, 0) // grid of everyMs from here

  it('fires for the first time one period after creation', () => {
    const result = resolveIntervalOccurrence(createdAt, 3_600_000, at(2026, 1, 1, 1, 0))
    expect(result.due).toBe(true)
    expect(result.occurrenceAt).toBe(createdAt + 3_600_000)
    expect(result.nextWakeAt).toBe(createdAt + 7_200_000)
  })

  it('is not due before the first occurrence', () => {
    const result = resolveIntervalOccurrence(createdAt, 3_600_000, at(2026, 1, 1, 0, 30))
    expect(result.due).toBe(false)
    expect(result.occurrenceAt).toBe(createdAt + 3_600_000)
  })

  it('advances past missed occurrences without replaying them', () => {
    // The process slept through 01:00, 02:00, and 03:00; at 03:20 the most
    // recent elapsed occurrence (03:00) is due exactly once.
    const result = resolveIntervalOccurrence(createdAt, 3_600_000, at(2026, 1, 1, 3, 20))
    expect(result.due).toBe(true)
    expect(result.occurrenceAt).toBe(at(2026, 1, 1, 3, 0))
    expect(result.nextWakeAt).toBe(at(2026, 1, 1, 4, 0))
  })

  it('keeps nextWakeAt strictly ahead of the current instant', () => {
    const result = resolveIntervalOccurrence(createdAt, 3_600_000, at(2026, 1, 1, 4, 0))
    expect(result.due).toBe(true)
    expect(result.nextWakeAt).toBe(at(2026, 1, 1, 5, 0))
  })
})

describe('cron parsing', () => {
  it('expands stars, lists, ranges, and steps', () => {
    const rule = parseCron('*/15 9-11 1,15 * 1-5')
    expect([...rule.minute]).toEqual([0, 15, 30, 45])
    expect([...rule.hour]).toEqual([9, 10, 11])
    expect([...rule.dom]).toEqual([1, 15])
    expect([...rule.dow]).toEqual([1, 2, 3, 4, 5])
    expect(rule.domRestricted).toBe(true)
    expect(rule.dowRestricted).toBe(true)
  })

  it('aliases Sunday 7 to 0', () => {
    const rule = parseCron('0 0 * * 0,7')
    expect([...rule.dow]).toEqual([0])
  })

  it('rejects a value outside its field bounds', () => {
    expect(() => parseCron('60 * * * *')).toThrow(CronRuleError)
  })

  it('rejects a descending range', () => {
    expect(() => parseCron('10-5 * * * *')).toThrow(CronRuleError)
  })

  it('rejects a zero step', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(CronRuleError)
  })

  it('rejects a field count other than five', () => {
    expect(() => parseCron('0 0 * *')).toThrow(CronRuleError)
  })

  it.each(['foo', '*/2/3', '1-2-3', '*-2', '1.5'])(
    'rejects malformed component %s',
    (component) => {
      expect(() => parseCron(`${component} * * * *`)).toThrow(CronRuleError)
    },
  )
})

describe('cron next match', () => {
  it('finds the next minute of an hourly rule', () => {
    const now = at(2026, 1, 1, 10, 0, 30)
    expect(nextCronMatch('30 * * * *', now)).toBe(at(2026, 1, 1, 10, 30))
  })

  it('returns the minute holding now when that minute matches', () => {
    const now = at(2026, 1, 1, 10, 30, 45)
    expect(nextCronMatch('30 * * * *', now)).toBe(at(2026, 1, 1, 10, 30))
  })

  it('crosses a day boundary', () => {
    const now = at(2026, 1, 1, 23, 59, 0)
    expect(nextCronMatch('5 0 * * *', now)).toBe(at(2026, 1, 2, 0, 5))
  })

  it('crosses a month boundary with a dom restriction', () => {
    const now = at(2026, 1, 31, 12, 0)
    expect(nextCronMatch('0 9 1 * *', now)).toBe(at(2026, 2, 1, 9, 0))
  })

  it('applies OR semantics when both day fields are restricted', () => {
    // Saturday 2026-01-03 falls on neither the 1st nor a weekday, but a
    // Saturday is admitted by the dow field alone.
    const now = at(2026, 1, 2, 12, 0)
    expect(nextCronMatch('0 9 1 * 6', now)).toBe(at(2026, 1, 3, 9, 0))
  })

  it('matches February 29 in a leap year', () => {
    const now = at(2028, 2, 28, 12, 0)
    expect(nextCronMatch('0 0 29 2 *', now)).toBe(at(2028, 2, 29, 0, 0))
  })

  it('crosses the non-leap century to the next February 29', () => {
    const afterLeapDay = at(2096, 3, 1, 0, 0)
    expect(nextCronMatch('0 0 29 2 *', afterLeapDay)).toBe(at(2104, 2, 29, 0, 0))
  })

  it('reports no match for an unsatisfiable rule', () => {
    const now = at(2026, 1, 1, 0, 0)
    expect(nextCronMatch('0 0 30 2 *', now)).toBeUndefined()
  })
})

describe('cron next match in a zone', () => {
  it('shifts the whole hour match by a whole-hour offset', () => {
    // 09:00 in Shanghai (+08:00) is 01:00 UTC on the same date.
    const now = at(2026, 8, 16, 0, 0)
    expect(nextCronMatch('0 9 * * *', now, 'Asia/Shanghai')).toBe(at(2026, 8, 16, 1, 0))
  })

  it('returns the minute holding now when that zone minute matches', () => {
    const now = at(2026, 8, 16, 1, 0, 30)
    expect(nextCronMatch('0 9 * * *', now, 'Asia/Shanghai')).toBe(at(2026, 8, 16, 1, 0))
  })

  it('fires a half-hour offset at its exact local minute boundary', () => {
    // 06:00 IST (+05:30) is 00:30 UTC; the search lands on the half-hour mark.
    const now = at(2026, 8, 16, 0, 0)
    expect(nextCronMatch('0 6 * * *', now, 'Asia/Kolkata')).toBe(at(2026, 8, 16, 0, 30))
    expect(nextCronMatch('30 6 * * *', now, 'Asia/Kolkata')).toBe(at(2026, 8, 16, 1, 0))
  })

  it('fires a quarter-hour offset at its exact local minute boundary', () => {
    // 06:00 in Kathmandu (+05:45) is 00:15 UTC.
    const now = at(2026, 8, 16, 0, 0)
    expect(nextCronMatch('0 6 * * *', now, 'Asia/Kathmandu')).toBe(at(2026, 8, 16, 0, 15))
  })

  it('matches zone-local day fields, not the UTC date', () => {
    // 09:00 Shanghai on 2026-08-16 is 01:00 UTC on the same date; a dom rule
    // pinned to the local 16th must not read the UTC day.
    const now = at(2026, 8, 15, 12, 0)
    expect(nextCronMatch('0 9 16 * *', now, 'Asia/Shanghai')).toBe(at(2026, 8, 16, 1, 0))
  })

  it('matches zone-local weekdays', () => {
    // 2026-08-17 is a Monday; 09:00 local is 01:00 UTC.
    const now = at(2026, 8, 16, 12, 0)
    expect(nextCronMatch('0 9 * * 1', now, 'Asia/Shanghai')).toBe(at(2026, 8, 17, 1, 0))
  })

  it('counts a local weekday that begins before the UTC midnight', () => {
    // Shanghai Monday 01:30 is Sunday 17:30 UTC; the dow must follow the
    // local calendar, not the UTC day of the instant.
    const now = at(2026, 8, 16, 12, 0)
    expect(nextCronMatch('30 1 * * 1', now, 'Asia/Shanghai')).toBe(at(2026, 8, 16, 17, 30))
  })

  it('applies Vixie OR semantics to zone-local day fields', () => {
    // The local Monday admits the 01:00 match although the restricted dom 20
    // does not match the local 17th.
    const now = at(2026, 8, 16, 12, 0)
    expect(nextCronMatch('0 1 20 * 1', now, 'Asia/Shanghai')).toBe(at(2026, 8, 16, 17, 0))
  })

  it('follows the daylight-saving offset of the target date', () => {
    // New York runs EST (-05:00) in January and EDT (-04:00) in July.
    expect(nextCronMatch('0 9 * * *', at(2026, 1, 15, 0, 0), 'America/New_York'))
      .toBe(at(2026, 1, 15, 14, 0))
    expect(nextCronMatch('0 9 * * *', at(2026, 7, 15, 0, 0), 'America/New_York'))
      .toBe(at(2026, 7, 15, 13, 0))
  })

  it('crosses the spring-forward gap to the shifted match', () => {
    // 2026-03-08 springs forward at 02:00 EST; 09:00 that day is already EDT.
    expect(nextCronMatch('0 9 * * *', at(2026, 3, 8, 0, 0), 'America/New_York'))
      .toBe(at(2026, 3, 8, 13, 0))
  })

  it('skips a local minute that does not exist in the spring gap', () => {
    // New York jumps from 01:59 to 03:00 on 2026-03-08; the daily 02:30 rule
    // therefore advances to 02:30 EDT on March 9.
    expect(nextCronMatch('30 2 * * *', at(2026, 3, 8, 5, 0), 'America/New_York'))
      .toBe(at(2026, 3, 9, 6, 30))
  })

  it('fires a repeated hour twice on fall-back day', () => {
    // 2026-11-01 falls back; 01:30 exists as EDT (05:30 UTC) and EST (06:30).
    expect(nextCronMatch('30 1 * * *', at(2026, 11, 1, 5, 0), 'America/New_York'))
      .toBe(at(2026, 11, 1, 5, 30))
    expect(nextCronMatch('30 1 * * *', at(2026, 11, 1, 5, 31), 'America/New_York'))
      .toBe(at(2026, 11, 1, 6, 30))
  })

  it('crosses the non-leap century in a zone', () => {
    // Local midnight in Shanghai is 16:00 UTC on the preceding date.
    const afterLeapDay = at(2096, 3, 1, 0, 0)
    expect(nextCronMatch('0 0 29 2 *', afterLeapDay, 'Asia/Shanghai'))
      .toBe(at(2104, 2, 28, 16, 0))
  })

  it('reports no match for an unsatisfiable rule in a zone', () => {
    const now = at(2026, 1, 1, 0, 0)
    expect(nextCronMatch('0 0 30 2 *', now, 'Asia/Shanghai')).toBeUndefined()
  })
})

describe('cron occurrences', () => {
  it('is due only inside the matching minute', () => {
    const inside = resolveCronOccurrence('30 * * * *', at(2026, 1, 1, 10, 30, 20))
    expect(inside.due).toBe(true)
    expect(inside.occurrenceAt).toBe(at(2026, 1, 1, 10, 30))
    expect(inside.nextWakeAt).toBe(at(2026, 1, 1, 11, 30))

    const outside = resolveCronOccurrence('30 * * * *', at(2026, 1, 1, 10, 31, 0))
    expect(outside.due).toBe(false)
    expect(outside.occurrenceAt).toBe(at(2026, 1, 1, 11, 30))
  })

  it('advances past a matching minute missed while asleep', () => {
    // Awake at 10:35 for a rule matching 10:30: the missed minute is not
    // replayed; the next match is reported instead.
    const result = resolveCronOccurrence('30 * * * *', at(2026, 1, 1, 10, 35))
    expect(result.due).toBe(false)
    expect(result.occurrenceAt).toBe(at(2026, 1, 1, 11, 30))
  })

  it('has no next wake for an unsatisfiable rule', () => {
    const result = resolveCronOccurrence('0 0 30 2 *', at(2026, 1, 1, 0, 0))
    expect(result.due).toBe(false)
    expect(result.occurrenceAt).toBeUndefined()
  })

  it('is due inside the zone minute and wakes on the next zone minute', () => {
    const inside = resolveCronOccurrence('0 9 * * *', at(2026, 8, 16, 1, 0, 20), 'Asia/Shanghai')
    expect(inside.due).toBe(true)
    expect(inside.occurrenceAt).toBe(at(2026, 8, 16, 1, 0))
    expect(inside.nextWakeAt).toBe(at(2026, 8, 17, 1, 0))

    const outside = resolveCronOccurrence('0 9 * * *', at(2026, 8, 16, 1, 1, 0), 'Asia/Shanghai')
    expect(outside.due).toBe(false)
    expect(outside.occurrenceAt).toBe(at(2026, 8, 17, 1, 0))
  })
})
