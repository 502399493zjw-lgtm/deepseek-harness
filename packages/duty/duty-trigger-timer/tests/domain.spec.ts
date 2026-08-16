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

  it('reports no match for an unsatisfiable rule', () => {
    const now = at(2026, 1, 1, 0, 0)
    expect(nextCronMatch('0 0 30 2 *', now)).toBeUndefined()
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
})
