import { describe, it, expect } from 'vitest'
import { isoDate } from './dates'

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
