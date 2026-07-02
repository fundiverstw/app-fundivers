import { describe, it, expect } from 'vitest'
import { WAIVERS, waiverByCode, ANNUAL_WAIVER_VALID_DAYS } from './waivers'

const COURSE_COLORS = ['ow', 'aow', 'dsd', 'rescue', 'specialty']
const CADENCES = ['annual', 'per_event']
const APPLIES = ['dives', 'courses', 'all', 'none']

describe('waiver config', () => {
  it('has unique, non-empty stable codes', () => {
    const codes = WAIVERS.map(w => w.code)
    expect(codes.every(c => c.trim().length > 0)).toBe(true)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('uses valid cadence / appliesTo and positive integer versions', () => {
    for (const w of WAIVERS) {
      expect(CADENCES).toContain(w.cadence)
      expect(APPLIES).toContain(w.appliesTo)
      expect(Number.isInteger(w.version)).toBe(true)
      expect(w.version).toBeGreaterThan(0)
      expect(w.title.trim().length).toBeGreaterThan(0)
      expect(w.body.trim().length).toBeGreaterThan(0)
    }
  })

  it('only restricts courseColors to known classifier buckets', () => {
    for (const w of WAIVERS) {
      if (!w.courseColors) continue
      expect(w.appliesTo).not.toBe('dives') // a course filter on a dives-only waiver is meaningless
      expect(w.courseColors.length).toBeGreaterThan(0)
      for (const c of w.courseColors) expect(COURSE_COLORS).toContain(c)
    }
  })

  it('ships the three PADI forms with their intended rules', () => {
    const liability = waiverByCode('padi_liability')
    expect(liability).toMatchObject({ cadence: 'annual', appliesTo: 'dives' })

    const medical = waiverByCode('diver_medical')
    expect(medical).toMatchObject({ cadence: 'annual', appliesTo: 'none' })

    const ce = waiverByCode('continuing_education')
    expect(ce).toMatchObject({ cadence: 'per_event', appliesTo: 'courses' })
    // Continuing-Ed covers real courses but excludes Discover Scuba / Try Dive.
    expect(ce?.courseColors).toEqual(expect.arrayContaining(['ow', 'aow', 'rescue', 'specialty']))
    expect(ce?.courseColors).not.toContain('dsd')
  })

  it('returns undefined for an unknown code', () => {
    expect(waiverByCode('nope')).toBeUndefined()
  })

  it('keeps the annual validity window at one year', () => {
    expect(ANNUAL_WAIVER_VALID_DAYS).toBe(365)
  })
})
