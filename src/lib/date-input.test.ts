import { describe, it, expect } from 'vitest'
import { maskYmd, isValidYmd } from './date-input'

describe('maskYmd', () => {
  it('inserts dashes as digits are typed', () => {
    expect(maskYmd('1')).toBe('1')
    expect(maskYmd('1987')).toBe('1987')
    expect(maskYmd('198705')).toBe('1987-05')
    expect(maskYmd('19870512')).toBe('1987-05-12')
  })
  it('ignores non-digits (so re-typing over dashes is harmless)', () => {
    expect(maskYmd('1987-05-12')).toBe('1987-05-12')
    expect(maskYmd('1987/05/12')).toBe('1987-05-12')
  })
  it('caps at 8 digits', () => {
    expect(maskYmd('1987051299')).toBe('1987-05-12')
  })
})

describe('isValidYmd', () => {
  it('accepts real calendar dates', () => {
    expect(isValidYmd('1987-05-12')).toBe(true)
    expect(isValidYmd('2000-02-29')).toBe(true) // leap year
  })
  it('rejects incomplete or malformed input', () => {
    expect(isValidYmd('1987')).toBe(false)
    expect(isValidYmd('1987-5-12')).toBe(false)
    expect(isValidYmd('')).toBe(false)
  })
  it('rejects impossible dates', () => {
    expect(isValidYmd('2026-02-30')).toBe(false)
    expect(isValidYmd('2026-13-01')).toBe(false)
    expect(isValidYmd('2025-02-29')).toBe(false) // not a leap year
  })
})
