import { describe, it, expect } from 'vitest'
import { packageDateLabel } from './package-format'

describe('packageDateLabel', () => {
  it('returns null when start is null', () => {
    expect(packageDateLabel(null, '2027-05-17')).toBeNull()
    expect(packageDateLabel(null, null)).toBeNull()
  })

  it('formats a single day when end is null', () => {
    expect(packageDateLabel('2027-05-15', null)).toBe('15 May 2027')
  })

  it('formats a single day when start and end are equal', () => {
    expect(packageDateLabel('2027-05-15', '2027-05-15')).toBe('15 May 2027')
  })

  it('formats a multi-day span within the same year', () => {
    expect(packageDateLabel('2027-05-15', '2027-05-17')).toBe('15 May – 17 May 2027')
  })

  it('formats a multi-day span across months', () => {
    expect(packageDateLabel('2027-05-30', '2027-06-02')).toBe('30 May – 2 Jun 2027')
  })

  it('formats a span across a year boundary using the end year', () => {
    expect(packageDateLabel('2027-12-30', '2028-01-02')).toBe('30 Dec – 2 Jan 2028')
  })

  it('does not zero-pad the day of month', () => {
    expect(packageDateLabel('2027-05-05', null)).toBe('5 May 2027')
    expect(packageDateLabel('2027-05-01', '2027-05-09')).toBe('1 May – 9 May 2027')
  })

  it('uses an en-dash separator, not a hyphen', () => {
    const label = packageDateLabel('2027-05-15', '2027-05-17')
    expect(label).toContain(' – ')
    expect(label).not.toContain(' - ')
  })

  it('renders the year from the start date when end is omitted', () => {
    expect(packageDateLabel('2026-01-09', null)).toBe('9 Jan 2026')
  })
})
