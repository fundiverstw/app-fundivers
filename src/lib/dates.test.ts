import { describe, it, expect, vi, afterEach } from 'vitest'
import { format } from 'date-fns'
import { isoDate, todayIso, parseIsoDate, addIsoDays, shopZoned, formatTimestamp, formatTimestampDay, diffIsoDays } from './dates'
import { siteConfig } from '../config/site'

const isTaipei = siteConfig.locale.timezone === 'Asia/Taipei'

afterEach(() => { vi.useRealTimers() })

describe('isoDate', () => {
  it('returns YYYY-MM-DD for a known UTC instant', () => {
    expect(isoDate(new Date('2027-05-15T12:34:56.000Z'))).toBe('2027-05-15')
  })

  it('uses UTC: a late-evening UTC instant keeps the UTC calendar day', () => {
    // 23:30 UTC on the 15th. In timezones west of UTC the local day would
    // still be the 15th, but east of UTC the local day rolls to the 16th —
    // asserting the 15th locks the UTC behaviour regardless of host TZ.
    expect(isoDate(new Date('2027-05-15T23:30:00.000Z'))).toBe('2027-05-15')
  })

  it('uses UTC: an early-morning UTC instant keeps the UTC calendar day', () => {
    // 00:30 UTC on the 16th — west-of-UTC local time would read the 15th.
    expect(isoDate(new Date('2027-05-16T00:30:00.000Z'))).toBe('2027-05-16')
  })

  it('matches the toISOString slice for an arbitrary instant', () => {
    const d = new Date('2026-12-31T18:00:00.000Z')
    expect(isoDate(d)).toBe(d.toISOString().slice(0, 10))
  })

  it('handles month and year boundaries', () => {
    expect(isoDate(new Date('2027-01-01T00:00:00.000Z'))).toBe('2027-01-01')
    expect(isoDate(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31')
  })
})

describe('todayIso', () => {
  it("returns the shop's calendar date, not UTC's", () => {
    // 02:00 in Taipei on the 26th is still the 25th in UTC. Slicing
    // toISOString() here pre-filled the dive-log form with yesterday for the
    // first eight hours of every day.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-25T18:00:00Z'))
    expect(isoDate(new Date())).toBe('2026-07-25')
    if (siteConfig.locale.timezone === 'Asia/Taipei') {
      expect(todayIso()).toBe('2026-07-26')
    }
  })

  it('is a well-formed YYYY-MM-DD whatever the configured timezone', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('parseIsoDate', () => {
  it('lands on local midnight of the stored day', () => {
    const d = parseIsoDate('2026-04-30')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3)
    expect(d.getDate()).toBe(30)
    expect(d.getHours()).toBe(0)
  })

  it('does not drift the way new Date() on a date-only string does', () => {
    // new Date('2026-04-30') is UTC midnight, which reads as the 29th anywhere
    // west of Greenwich. The stored calendar date must survive the round trip.
    for (const iso of ['2026-01-01', '2026-04-30', '2026-12-31']) {
      const d = parseIsoDate(iso)
      const back = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      expect(back).toBe(iso)
    }
  })
})

describe('addIsoDays', () => {
  it('adds and subtracts whole days', () => {
    expect(addIsoDays('2026-04-30', 1)).toBe('2026-05-01')
    expect(addIsoDays('2026-05-01', -1)).toBe('2026-04-30')
    expect(addIsoDays('2026-04-30', 0)).toBe('2026-04-30')
  })

  it('crosses a year boundary', () => {
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('handles a leap day', () => {
    expect(addIsoDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addIsoDays('2028-02-29', 1)).toBe('2028-03-01')
  })
})

describe('shopZoned', () => {
  // Whatever timezone the test runner sits in, formatting a shop-zoned instant
  // must render the shop's wall clock, not the runner's. These lock Asia/Taipei
  // (UTC+8): 16:00Z is midnight the next day in Taipei.
  it.runIf(isTaipei)('carries the shop wall clock into a date-fns format', () => {
    expect(format(shopZoned(new Date('2026-05-14T16:00:00.000Z')), 'yyyy-MM-dd HH:mm'))
      .toBe('2026-05-15 00:00')
  })

  it.runIf(isTaipei)('renders the shop day for an instant that is the previous day in UTC', () => {
    // 20:00Z May 14 is still May 14 in UTC / the Americas, but 04:00 May 15 in
    // Taipei — the day a diver abroad must see for a Taipei event.
    expect(format(shopZoned(new Date('2026-05-14T20:00:00.000Z')), 'EEE, MMM d'))
      .toBe('Fri, May 15')
  })

  it.runIf(isTaipei)('folds a midnight boundary to hour 0, never 24', () => {
    expect(shopZoned(new Date('2026-05-14T16:00:00.000Z')).getHours()).toBe(0)
  })

  it('leaves an unparseable Date untouched so callers throw/guard as before', () => {
    const bad = new Date('nonsense')
    expect(Number.isNaN(shopZoned(bad).getTime())).toBe(true)
  })
})

describe('formatTimestamp', () => {
  it('formats a timestamptz with the given pattern in the shop timezone', () => {
    expect(formatTimestamp('2026-07-30T09:15:00Z', 'MMM d, yyyy')).toMatch(/Jul \d+, 2026/)
  })

  it.runIf(isTaipei)('uses the shop day, not UTC, near midnight', () => {
    expect(formatTimestamp('2026-05-14T20:00:00.000Z', 'yyyy-MM-dd')).toBe('2026-05-15')
  })

  it('returns null for null / undefined / empty / unparseable', () => {
    expect(formatTimestamp(null, 'PP')).toBeNull()
    expect(formatTimestamp(undefined, 'PP')).toBeNull()
    expect(formatTimestamp('', 'PP')).toBeNull()
    expect(formatTimestamp('not a date', 'PP')).toBeNull()
  })
})

describe('formatTimestampDay', () => {
  it('renders a timestamptz as a short day', () => {
    expect(formatTimestampDay('2026-07-30T09:15:00Z')).toMatch(/Jul \d+, 2026/)
  })

  it('returns null for null / undefined / empty', () => {
    expect(formatTimestampDay(null)).toBeNull()
    expect(formatTimestampDay(undefined)).toBeNull()
    expect(formatTimestampDay('')).toBeNull()
  })

  // The whole reason it exists: date-fns `format` throws "Invalid time value"
  // on an unparseable string, and these render inside much larger admin cards.
  it('returns null instead of throwing on an unparseable value', () => {
    expect(formatTimestampDay('not a date')).toBeNull()
    expect(formatTimestampDay('undefined')).toBeNull()
  })
})

describe('diffIsoDays', () => {
  it('counts whole days forward and back', () => {
    expect(diffIsoDays('2026-08-01', '2026-08-08')).toBe(7)
    expect(diffIsoDays('2026-08-08', '2026-08-01')).toBe(-7)
    expect(diffIsoDays('2026-08-01', '2026-08-01')).toBe(0)
  })

  it('crosses months and years', () => {
    expect(diffIsoDays('2026-08-30', '2026-09-02')).toBe(3)
    expect(diffIsoDays('2026-12-31', '2027-01-01')).toBe(1)
  })

  it('counts the leap day', () => {
    expect(diffIsoDays('2028-02-28', '2028-03-01')).toBe(2)
    expect(diffIsoDays('2027-02-28', '2027-03-01')).toBe(1)
  })

  // Whole-day arithmetic must not pick up an hour of DST drift, whatever
  // timezone a fork of this app runs in.
  it('is a whole number across a northern-hemisphere DST switch', () => {
    expect(diffIsoDays('2026-03-01', '2026-04-01')).toBe(31)
    expect(diffIsoDays('2026-10-01', '2026-11-01')).toBe(31)
  })

  it('round-trips against addIsoDays', () => {
    const from = '2026-08-01'
    for (const days of [1, 13, 40, 365]) {
      expect(diffIsoDays(from, addIsoDays(from, days))).toBe(days)
    }
  })
})
