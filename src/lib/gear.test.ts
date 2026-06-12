import { describe, it, expect } from 'vitest'
import { isGearIncludedCourse } from './gear'

describe('isGearIncludedCourse', () => {
  it('treats Open Water courses as gear-included', () => {
    expect(isGearIncludedCourse('Open Water Course')).toBe(true)
    expect(isGearIncludedCourse('PADI Open Water Course')).toBe(true)
    expect(isGearIncludedCourse('open water')).toBe(true)
  })

  it('treats Discover Scuba / DSD / Try Dive as gear-included', () => {
    expect(isGearIncludedCourse('Discover Scuba Diving')).toBe(true)
    expect(isGearIncludedCourse('DSD')).toBe(true)
    expect(isGearIncludedCourse('Try Dive')).toBe(true)
  })

  it('treats EFR (dry first-aid course) as gear-included', () => {
    expect(isGearIncludedCourse('EFR Course')).toBe(true)
    expect(isGearIncludedCourse('Emergency First Response')).toBe(true)
  })

  it('does NOT bundle gear for Advanced Open Water', () => {
    expect(isGearIncludedCourse('Advanced Open Water')).toBe(false)
    expect(isGearIncludedCourse('PADI Advanced Open Water Course')).toBe(false)
  })

  it('does NOT bundle gear for other continuing-ed courses', () => {
    expect(isGearIncludedCourse('EANx / Nitrox Course')).toBe(false)
    expect(isGearIncludedCourse('Deep Specialty')).toBe(false)
    expect(isGearIncludedCourse('PADI Rescue Course')).toBe(false)
    expect(isGearIncludedCourse('Equipment Course')).toBe(false)
  })

  it('handles null / empty titles', () => {
    expect(isGearIncludedCourse(null)).toBe(false)
    expect(isGearIncludedCourse(undefined)).toBe(false)
    expect(isGearIncludedCourse('')).toBe(false)
  })
})
