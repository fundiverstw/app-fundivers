import { describe, it, expect } from 'vitest'
import {
  SHOE_UNITS,
  convertShoeSize,
  formatShoeSize,
  parseShoeSize,
  shoeAsJp,
  shoeSizesFor,
} from './shoe-size'

describe('shoeSizesFor', () => {
  it('lists EU sizes for men', () => {
    const sizes = shoeSizesFor('eu', 'm')
    expect(sizes[0]).toBe(35)
    expect(sizes.at(-1)).toBe(47.5)
    expect(sizes).toHaveLength(21)
  })

  it('lists JP sizes for women', () => {
    const sizes = shoeSizesFor('jp', 'f')
    expect(sizes[0]).toBe(21)
    expect(sizes.at(-1)).toBe(31)
  })
})

describe('convertShoeSize', () => {
  it('returns the same value when units match', () => {
    expect(convertShoeSize(42, 'eu', 'eu', 'm')).toBe(42)
  })

  it('converts EU 41 men → US 8', () => {
    expect(convertShoeSize(41, 'eu', 'us', 'm')).toBe(8)
  })

  it('converts EU 41 men → JP 26', () => {
    expect(convertShoeSize(41, 'eu', 'jp', 'm')).toBe(26)
  })

  it('converts US 9 women → EU 40', () => {
    expect(convertShoeSize(9, 'us', 'eu', 'f')).toBe(40)
  })

  it('snaps to the nearest row when value is off-table', () => {
    // EU 40.7 should snap to 41 men's row → US 8
    expect(convertShoeSize(40.7, 'eu', 'us', 'm')).toBe(8)
  })

  it('returns null for NaN input', () => {
    expect(convertShoeSize(Number.NaN, 'eu', 'us', 'm')).toBeNull()
  })
})

describe('formatShoeSize / parseShoeSize', () => {
  it('round-trips the canonical format', () => {
    const s = formatShoeSize(41, 'eu', 'm')
    expect(s).toBe('EU 41 M')
    expect(parseShoeSize(s)).toEqual({ value: 41, unit: 'eu', gender: 'm' })
  })

  it('parses legacy values without gender', () => {
    expect(parseShoeSize('EU 41')).toEqual({ value: 41, unit: 'eu', gender: 'm' })
  })

  it('parses bare numbers as EU men (backwards compat)', () => {
    expect(parseShoeSize('41')).toEqual({ value: 41, unit: 'eu', gender: 'm' })
  })

  it('parses US sizes case-insensitively', () => {
    expect(parseShoeSize('us 9 f')).toEqual({ value: 9, unit: 'us', gender: 'f' })
  })

  it('returns null for empty / null input', () => {
    expect(parseShoeSize('')).toBeNull()
    expect(parseShoeSize(null)).toBeNull()
    expect(parseShoeSize(undefined)).toBeNull()
  })

  it('returns null for garbage', () => {
    expect(parseShoeSize('not a size')).toBeNull()
  })
})

describe('shoeAsJp', () => {
  it('converts a canonical EU men size to JP', () => {
    // EU 41 men → JP 26
    expect(shoeAsJp('EU 41 M')).toBe('JP 26')
  })

  it('returns null for empty / garbage input', () => {
    expect(shoeAsJp(null)).toBeNull()
    expect(shoeAsJp('')).toBeNull()
    expect(shoeAsJp('nope')).toBeNull()
  })

  it('leaves JP input unchanged', () => {
    expect(shoeAsJp('JP 26 M')).toBe('JP 26')
  })
})

describe('SHOE_UNITS export', () => {
  it('includes every supported unit', () => {
    expect(SHOE_UNITS).toEqual(['eu', 'us', 'uk', 'jp', 'cm'])
  })
})
