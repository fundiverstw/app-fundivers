import { describe, it, expect } from 'vitest'
import { isGearIncludedCourse, gearPackList } from './gear'
import type { Booking } from '../types/database'

const bookingWith = (gear: unknown): Booking =>
  ({ details: { gear } } as unknown as Booking)

describe('gearPackList', () => {
  it('packs nothing for a diver on their own gear', () => {
    expect(gearPackList(bookingWith({ rent: false }))).toEqual({ summary: 'Own gear', items: [] })
    expect(gearPackList(bookingWith(undefined))).toEqual({ summary: 'Own gear', items: [] })
  })

  it('packs a full set for course-included gear', () => {
    const out = gearPackList(bookingWith({ rent: false, included: true }))
    expect(out.summary).toBe('Included with course')
    expect(out.items).toContain('BCD')
    expect(out.items).toContain('Dive computer')
  })

  it('surfaces the assistance note and packs nothing yet', () => {
    const out = gearPackList(bookingWith({ rent: false, assistance_note: 'unsure on fins' }))
    expect(out).toEqual({ summary: 'Needs help', items: [], note: 'unsure on fins' })
  })

  it('packs exactly the à-la-carte items', () => {
    const out = gearPackList(bookingWith({ rent: true, items: ['BCD', 'Fins'] }))
    expect(out.summary).toBe('À-la-carte (2)')
    expect(out.items).toEqual(['BCD', 'Fins'])
  })
})

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
