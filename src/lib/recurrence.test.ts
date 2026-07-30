import { describe, it, expect } from 'vitest'
import {
  occurrenceDates, datesAfter, validateRecurrence, isoWeekday,
  nthWeekdayOfMonth, monthPositionOf, MAX_OCCURRENCES,
  type RecurrenceRule,
} from './recurrence'

// 2026-08-01 is a Saturday; the whole file leans on that.
const SAT = '2026-08-01'

const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  freq: 'weekly', interval: 1, count: 4, ...over,
})

describe('isoWeekday', () => {
  it('numbers Monday 1 through Sunday 7', () => {
    expect(isoWeekday('2026-07-27')).toBe(1)  // Mon
    expect(isoWeekday(SAT)).toBe(6)           // Sat
    expect(isoWeekday('2026-08-02')).toBe(7)  // Sun
  })
})

describe('occurrenceDates — daily', () => {
  it('steps by the interval from the anchor', () => {
    expect(occurrenceDates(rule({ freq: 'daily', count: 3 }), SAT))
      .toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
    expect(occurrenceDates(rule({ freq: 'daily', interval: 3, count: 3 }), SAT))
      .toEqual(['2026-08-01', '2026-08-04', '2026-08-07'])
  })

  it('crosses a month boundary in calendar space', () => {
    expect(occurrenceDates(rule({ freq: 'daily', count: 3 }), '2026-08-30'))
      .toEqual(['2026-08-30', '2026-08-31', '2026-09-01'])
  })
})

describe('occurrenceDates — weekly', () => {
  it('repeats the anchor weekday', () => {
    expect(occurrenceDates(rule({ weekdays: [6], count: 3 }), SAT))
      .toEqual(['2026-08-01', '2026-08-08', '2026-08-15'])
  })

  it('runs several weekdays per week, in ascending order', () => {
    expect(occurrenceDates(rule({ weekdays: [6, 7], count: 4 }), SAT))
      .toEqual(['2026-08-01', '2026-08-02', '2026-08-08', '2026-08-09'])
  })

  // A Sat anchor with Sat+Sun must not reach back to the Sunday BEFORE it,
  // which shares the same ISO week (Mon-start).
  it('never emits a date before the anchor', () => {
    const dates = occurrenceDates(rule({ weekdays: [1, 6], count: 4 }), SAT)
    expect(dates[0]).toBe(SAT)
    expect(dates.every(d => d >= SAT)).toBe(true)
    // Monday is earlier in the week than Saturday, so its first hit is next week.
    expect(dates).toEqual(['2026-08-01', '2026-08-03', '2026-08-08', '2026-08-10'])
  })

  it('skips whole weeks for an interval above one', () => {
    expect(occurrenceDates(rule({ weekdays: [6], interval: 2, count: 3 }), SAT))
      .toEqual(['2026-08-01', '2026-08-15', '2026-08-29'])
  })

  // The anchor is the event being filled in, so it is occurrence #1 whether or
  // not its weekday was ticked. The form locks that weekday for this reason.
  it('includes the anchor even when its weekday was not selected', () => {
    const dates = occurrenceDates(rule({ weekdays: [3], count: 3 }), SAT)
    expect(dates[0]).toBe(SAT)
    expect(dates).toEqual(['2026-08-01', '2026-08-05', '2026-08-08'])
  })
})

describe('nthWeekdayOfMonth', () => {
  it('finds the nth weekday counting from the start of the month', () => {
    // Fridays in Aug 2026: 7, 14, 21, 28.
    expect(nthWeekdayOfMonth(2026, 8, 5, 1)).toBe('2026-08-07')
    expect(nthWeekdayOfMonth(2026, 8, 5, 3)).toBe('2026-08-21')
  })

  it('finds the last one for position -1', () => {
    expect(nthWeekdayOfMonth(2026, 8, 5, -1)).toBe('2026-08-28')
    // Aug 2026 has five Sundays: 2, 9, 16, 23, 30.
    expect(nthWeekdayOfMonth(2026, 8, 7, -1)).toBe('2026-08-30')
  })

  it('handles February in a leap year', () => {
    // Feb 2028 has 29 days, starting Tuesday. Mondays: 7, 14, 21, 28.
    expect(nthWeekdayOfMonth(2028, 2, 1, -1)).toBe('2028-02-28')
    expect(nthWeekdayOfMonth(2028, 2, 1, 4)).toBe('2028-02-28')
  })
})

describe('monthPositionOf', () => {
  it('reports the ordinal for a weekday that is not the last', () => {
    expect(monthPositionOf('2026-08-07')).toBe(1)   // 1st Friday
    expect(monthPositionOf('2026-08-21')).toBe(3)   // 3rd Friday
  })

  // A 5th Friday cannot be expressed as an ordinal without skipping most
  // months, so the last matching weekday always reports as "last".
  it('reports the last matching weekday as -1', () => {
    expect(monthPositionOf('2026-08-28')).toBe(-1)  // 4th AND last Friday
    expect(monthPositionOf('2026-08-30')).toBe(-1)  // 5th AND last Sunday
  })
})

describe('occurrenceDates — monthly by weekday position', () => {
  it('repeats the first Friday of each month', () => {
    expect(occurrenceDates(rule({ freq: 'monthly_weekday', count: 3 }), '2026-08-07'))
      .toEqual(['2026-08-07', '2026-09-04', '2026-10-02'])
  })

  it('repeats the last Sunday of each month', () => {
    expect(occurrenceDates(rule({ freq: 'monthly_weekday', count: 3 }), '2026-08-30'))
      .toEqual(['2026-08-30', '2026-09-27', '2026-10-25'])
  })

  it('skips months at an interval above one', () => {
    expect(occurrenceDates(rule({ freq: 'monthly_weekday', interval: 3, count: 3 }), '2026-08-07'))
      .toEqual(['2026-08-07', '2026-11-06', '2027-02-05'])
  })

  it('rolls the year over', () => {
    const dates = occurrenceDates(rule({ freq: 'monthly_weekday', count: 7 }), '2026-08-07')
    expect(dates[5]).toBe('2027-01-01')
    expect(dates).toHaveLength(7)
  })

  it('terminates rather than spinning when a position cannot be satisfied', () => {
    // Positions 1-4 and -1 always exist, so this is really a guard against the
    // loop hanging: it must return promptly whatever the interval.
    const dates = occurrenceDates(rule({ freq: 'monthly_weekday', interval: 12, count: 4 }), '2026-08-07')
    expect(dates).toEqual(['2026-08-07', '2027-08-06', '2028-08-04', '2029-08-03'])
  })
})

describe('occurrenceDates — bounds', () => {
  it('never returns more than the cap, whatever the count asks for', () => {
    const dates = occurrenceDates(rule({ freq: 'daily', count: 5000 }), SAT)
    expect(dates).toHaveLength(MAX_OCCURRENCES)
  })

  it('treats an interval below one as one rather than looping forever', () => {
    expect(occurrenceDates(rule({ freq: 'daily', interval: 0, count: 3 }), SAT))
      .toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
  })

  it('returns just the anchor for a count of one', () => {
    expect(occurrenceDates(rule({ count: 1, weekdays: [6] }), SAT)).toEqual([SAT])
  })
})

describe('datesAfter', () => {
  it('continues a weekly pattern from the last occurrence, excluding it', () => {
    expect(datesAfter(rule({ weekdays: [6] }), '2026-08-15', 2))
      .toEqual(['2026-08-22', '2026-08-29'])
  })

  it('continues a multi-weekday pattern', () => {
    // Last occurrence was a Sunday in a Sat+Sun series.
    expect(datesAfter(rule({ weekdays: [6, 7] }), '2026-08-09', 3))
      .toEqual(['2026-08-15', '2026-08-16', '2026-08-22'])
  })

  it('continues a monthly pattern', () => {
    expect(datesAfter(rule({ freq: 'monthly_weekday' }), '2026-10-02', 2))
      .toEqual(['2026-11-06', '2026-12-04'])
  })
})

describe('validateRecurrence', () => {
  it('accepts a sane weekly rule', () => {
    expect(validateRecurrence(rule({ weekdays: [6] }))).toEqual([])
  })

  it('rejects a count below two — that is not a series', () => {
    expect(validateRecurrence(rule({ count: 1, weekdays: [6] })).map(p => p.field)).toEqual(['count'])
  })

  it('rejects a count above the cap', () => {
    expect(validateRecurrence(rule({ count: MAX_OCCURRENCES + 1, weekdays: [6] })).map(p => p.field))
      .toEqual(['count'])
  })

  it('rejects a non-integer or out-of-range interval', () => {
    expect(validateRecurrence(rule({ interval: 0, weekdays: [6] })).map(p => p.field)).toEqual(['interval'])
    expect(validateRecurrence(rule({ interval: 1.5, weekdays: [6] })).map(p => p.field)).toEqual(['interval'])
    expect(validateRecurrence(rule({ interval: 99, weekdays: [6] })).map(p => p.field)).toEqual(['interval'])
  })

  it('requires at least one weekday for a weekly rule, and none for the others', () => {
    expect(validateRecurrence(rule({ weekdays: [] })).map(p => p.field)).toEqual(['weekdays'])
    expect(validateRecurrence(rule({ freq: 'daily' }))).toEqual([])
    expect(validateRecurrence(rule({ freq: 'monthly_weekday' }))).toEqual([])
  })
})
