import { describe, it, expect } from 'vitest'
import { numOrNull } from './num'

describe('numOrNull', () => {
  it('parses a numeric string', () => {
    expect(numOrNull('8.5')).toBe(8.5)
    expect(numOrNull('-2')).toBe(-2)
    expect(numOrNull('0')).toBe(0)
  })

  it('passes a finite number through, and rejects a non-finite one', () => {
    expect(numOrNull(12)).toBe(12)
    expect(numOrNull(NaN)).toBeNull()
    expect(numOrNull(Infinity)).toBeNull()
  })

  it('treats blank, whitespace, null and undefined as no value', () => {
    expect(numOrNull('')).toBeNull()
    expect(numOrNull('   ')).toBeNull()
    expect(numOrNull(null)).toBeNull()
    expect(numOrNull(undefined)).toBeNull()
  })

  // A partly-numeric string in a form field is a typo. parseFloat would keep
  // the prefix and store a measurement nobody entered.
  it('rejects a partly-numeric string rather than keeping its prefix', () => {
    expect(numOrNull('12abc')).toBeNull()
    expect(numOrNull('abc')).toBeNull()
  })

  it('tolerates surrounding whitespace on a real value', () => {
    expect(numOrNull('  8.5  ')).toBe(8.5)
  })
})
