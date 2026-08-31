import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  readUnitSystem, writeUnitSystem,
  cmToFeetInches, feetInchesToCm, kgToLb, lbToKg,
  displayHeight, displayWeight, sameHeight, sameWeight,
} from './units'

describe('height conversion', () => {
  it('splits centimeters into whole feet and inches', () => {
    expect(cmToFeetInches(182.9)).toEqual({ feet: 6, inches: 0 })
    expect(cmToFeetInches(170)).toEqual({ feet: 5, inches: 7 })
    expect(cmToFeetInches(152.4)).toEqual({ feet: 5, inches: 0 })
  })

  it('rounds into the inch grid rather than reporting a fractional inch', () => {
    // 180cm is 70.87 inches. A diver reads that as 5'11", not 5'10.87".
    expect(cmToFeetInches(180)).toEqual({ feet: 5, inches: 11 })
  })

  it('converts feet and inches back to one decimal place of centimeters', () => {
    expect(feetInchesToCm({ feet: 6, inches: 0 })).toBe(182.9)
    expect(feetInchesToCm({ feet: 5, inches: 7 })).toBe(170.2)
  })

  it('handles a height under a foot without producing a negative remainder', () => {
    expect(cmToFeetInches(20)).toEqual({ feet: 0, inches: 8 })
  })
})

describe('weight conversion', () => {
  it('converts kilograms to whole pounds and back', () => {
    expect(kgToLb(70)).toBe(154)
    expect(lbToKg(154)).toBe(69.9)
    expect(kgToLb(100)).toBe(220)
  })
})

describe('display helpers', () => {
  it('passes metric through untouched', () => {
    expect(displayHeight(170, 'metric')).toBe(170)
    expect(displayWeight(70, 'metric')).toBe(70)
  })

  it('converts for imperial', () => {
    expect(displayHeight(170, 'imperial')).toEqual({ feet: 5, inches: 7 })
    expect(displayWeight(70, 'imperial')).toBe(154)
  })

  // An unset measurement must not become a confident 0 — the shop reads a blank
  // height as "not asked yet" and a 0 as "answered, badly".
  it('keeps an unset measurement unset in both systems', () => {
    expect(displayHeight(null, 'imperial')).toBeNull()
    expect(displayHeight(null, 'metric')).toBeNull()
    expect(displayWeight(null, 'imperial')).toBeNull()
  })
})

describe('round-trip stability guards', () => {
  // The inch grid is coarser than the centimeter grid: 180cm shows as 5'11",
  // which converts back to 180.3cm. sameHeight is what stops a diver who only
  // *looked* at the imperial view from having their stored height nudged.
  it('treats a height and its own imperial rendering as unchanged', () => {
    expect(sameHeight(180, cmToFeetInches(180))).toBe(true)
    expect(sameHeight(180, { feet: 6, inches: 0 })).toBe(false)
  })

  it('treats a weight and its own pound rendering as unchanged', () => {
    expect(sameWeight(70, kgToLb(70))).toBe(true)
    expect(sameWeight(70, 155)).toBe(false)
  })

  it('counts two unset values as the same, and one-sided ones as different', () => {
    expect(sameHeight(null, null)).toBe(true)
    expect(sameHeight(180, null)).toBe(false)
    expect(sameWeight(null, null)).toBe(true)
    expect(sameWeight(null, 154)).toBe(false)
  })
})

describe('preference storage', () => {
  beforeEach(() => localStorage.clear())

  it('falls back to the shop default when nothing is stored', () => {
    // fundive.config.ts ships metric.
    expect(readUnitSystem()).toBe('metric')
  })

  it('round-trips a stored choice', () => {
    writeUnitSystem('imperial')
    expect(readUnitSystem()).toBe('imperial')
  })

  it('ignores a junk value rather than returning it', () => {
    localStorage.setItem('fundive.units', 'furlongs')
    expect(readUnitSystem()).toBe('metric')
  })

  // A private-mode browser throws on getItem/setItem. The field must still
  // render, on the default, rather than taking the page down.
  it('survives storage being unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(readUnitSystem()).toBe('metric')
    expect(() => writeUnitSystem('imperial')).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })
})
