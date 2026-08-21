import { describe, it, expect } from 'vitest'
import {
  CORAL_HUES, CORAL_LEVELS, CORAL_TYPES, CORAL_SURVEY_METHODS,
  BLEACHED_AT_OR_BELOW, colonyScore, isBleached, summarizeSurvey,
  colonyProblem, colonyFromDraft, emptyColonyDraft, headerProblem, SURVEY_LIMITS,
  type CoralColony, type ColonyDraft,
} from './coral-survey'

const colony = (over: Partial<CoralColony> = {}): CoralColony => ({
  coral_type: 'branching',
  lightest_hue: 'C', lightest_level: 3,
  darkest_hue: 'C', darkest_level: 4,
  diameter_cm: 25,
  ...over,
})

const draft = (over: Partial<ColonyDraft> = {}): ColonyDraft => ({
  coral_type: 'boulder',
  lightest_hue: 'B', lightest_level: '2',
  darkest_hue: 'B', darkest_level: '4',
  diameter_cm: '40',
  ...over,
})

describe('the chart vocabulary', () => {
  it('is the printed CoralWatch chart: four hues, six levels', () => {
    expect(CORAL_HUES).toEqual(['B', 'C', 'D', 'E'])
    expect(CORAL_LEVELS).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('names the growth forms the chart distinguishes', () => {
    expect(CORAL_TYPES).toEqual(['branching', 'boulder', 'plate', 'soft'])
  })

  it('offers the three survey methods the schema accepts', () => {
    expect(CORAL_SURVEY_METHODS).toEqual(['random', 'transect', 'quadrat'])
  })
})

describe('colonyScore', () => {
  it('is the midpoint of the palest and darkest match', () => {
    expect(colonyScore(colony({ lightest_level: 2, darkest_level: 4 }))).toBe(3)
  })

  it('is the level itself for a colony of one shade', () => {
    expect(colonyScore(colony({ lightest_level: 5, darkest_level: 5 }))).toBe(5)
  })

  // The midpoint rather than the minimum, on purpose: a colony pale at one
  // branch tip and pigmented elsewhere is not a bleached colony.
  it('does not score a partly pale colony as its worst patch', () => {
    expect(colonyScore(colony({ lightest_level: 1, darkest_level: 6 }))).toBe(3.5)
  })
})

describe('isBleached', () => {
  it('judges on the darkest shade, not the lightest', () => {
    expect(isBleached(colony({ lightest_level: 1, darkest_level: 5 }))).toBe(false)
    expect(isBleached(colony({ lightest_level: 1, darkest_level: 2 }))).toBe(true)
  })

  it('draws the line at the documented level', () => {
    expect(isBleached(colony({ lightest_level: 1, darkest_level: BLEACHED_AT_OR_BELOW }))).toBe(true)
    expect(isBleached(colony({
      lightest_level: 1, darkest_level: (BLEACHED_AT_OR_BELOW + 1) as 3,
    }))).toBe(false)
  })
})

describe('summarizeSurvey', () => {
  it('reports count, mean score and bleached fraction', () => {
    const summary = summarizeSurvey([
      colony({ lightest_level: 1, darkest_level: 1 }),
      colony({ lightest_level: 3, darkest_level: 5 }),
    ])
    expect(summary.count).toBe(2)
    expect(summary.meanScore).toBe(2.5)
    expect(summary.bleachedCount).toBe(1)
    expect(summary.bleachedFraction).toBe(0.5)
  })

  // Zero would read as total bleaching; there is a difference between a reef
  // with no pigment and a form nobody filled in.
  it('returns nulls rather than zeros for a survey of nothing', () => {
    const summary = summarizeSurvey([])
    expect(summary.count).toBe(0)
    expect(summary.meanScore).toBeNull()
    expect(summary.bleachedFraction).toBeNull()
  })

  it('counts every growth form, including the ones nobody recorded', () => {
    const summary = summarizeSurvey([
      colony({ coral_type: 'soft' }),
      colony({ coral_type: 'soft' }),
      colony({ coral_type: 'plate' }),
    ])
    expect(summary.byType).toEqual({ branching: 0, boulder: 0, plate: 1, soft: 2 })
  })
})

describe('colonyProblem', () => {
  it('passes a complete row', () => {
    expect(colonyProblem(draft())).toBeNull()
  })

  it('reports a blank row as incomplete rather than as any other fault', () => {
    expect(colonyProblem(emptyColonyDraft())).toBe('incomplete')
  })

  it('names a missing field even when the rest of the row is valid', () => {
    expect(colonyProblem(draft({ darkest_hue: '' }))).toBe('incomplete')
    expect(colonyProblem(draft({ lightest_level: '' }))).toBe('incomplete')
  })

  // The chart is read palest-first, so this is a transposed pair rather than
  // an impossible colony, and it deserves its own message.
  it('catches a darkest shade paler than the lightest', () => {
    expect(colonyProblem(draft({ lightest_level: '5', darkest_level: '2' }))).toBe('shade_order')
  })

  it('accepts equal shades', () => {
    expect(colonyProblem(draft({ lightest_level: '3', darkest_level: '3' }))).toBeNull()
  })

  it('accepts a blank diameter — a shade reading stands without a rule', () => {
    expect(colonyProblem(draft({ diameter_cm: '' }))).toBeNull()
    expect(colonyProblem(draft({ diameter_cm: '  ' }))).toBeNull()
  })

  it('rejects a diameter that is not a positive measurement', () => {
    expect(colonyProblem(draft({ diameter_cm: '0' }))).toBe('diameter')
    expect(colonyProblem(draft({ diameter_cm: '-5' }))).toBe('diameter')
    expect(colonyProblem(draft({ diameter_cm: 'wide' }))).toBe('diameter')
    expect(colonyProblem(draft({ diameter_cm: '5000' }))).toBe('diameter')
  })
})

describe('colonyFromDraft', () => {
  it('converts a complete row, with numbers as numbers', () => {
    expect(colonyFromDraft(draft())).toEqual({
      coral_type: 'boulder',
      lightest_hue: 'B', lightest_level: 2,
      darkest_hue: 'B', darkest_level: 4,
      diameter_cm: 40,
    })
  })

  it('sends a blank diameter as null, not as zero', () => {
    expect(colonyFromDraft(draft({ diameter_cm: '' }))?.diameter_cm).toBeNull()
  })

  it('refuses a row the validator rejects', () => {
    expect(colonyFromDraft(draft({ coral_type: '' }))).toBeNull()
    expect(colonyFromDraft(draft({ lightest_level: '6', darkest_level: '1' }))).toBeNull()
  })
})

describe('headerProblem', () => {
  it('accepts a header with nothing filled in — every field is optional', () => {
    expect(headerProblem({})).toBeNull()
    expect(headerProblem({ depth_m: null, water_temp_c: null, transect_length_m: null })).toBeNull()
  })

  it('accepts values inside the ranges the schema allows', () => {
    expect(headerProblem({ depth_m: 0 })).toBeNull()
    expect(headerProblem({ depth_m: 100 })).toBeNull()
    expect(headerProblem({ water_temp_c: -2 })).toBeNull()
    expect(headerProblem({ water_temp_c: 40 })).toBeNull()
    expect(headerProblem({ transect_length_m: 500 })).toBeNull()
  })

  it('names the field that is out of range', () => {
    expect(headerProblem({ depth_m: 120 })).toBe('depth_m')
    expect(headerProblem({ depth_m: -1 })).toBe('depth_m')
    expect(headerProblem({ water_temp_c: 45 })).toBe('water_temp_c')
    expect(headerProblem({ transect_length_m: 900 })).toBe('transect_length_m')
  })

  // The schema wants a transect longer than zero, not merely non-negative:
  // a transect of no length is not a transect.
  it('refuses a zero-length transect while allowing a zero depth', () => {
    expect(headerProblem({ transect_length_m: 0 })).toBe('transect_length_m')
    expect(headerProblem({ depth_m: 0 })).toBeNull()
  })

  it('reports the first offending field when several are wrong', () => {
    expect(headerProblem({ depth_m: 120, water_temp_c: 99 })).toBe('depth_m')
  })

  it('states the same bounds the migration does', () => {
    expect(SURVEY_LIMITS.depth_m).toEqual({ min: 0, max: 100 })
    expect(SURVEY_LIMITS.water_temp_c).toEqual({ min: -2, max: 40 })
    expect(SURVEY_LIMITS.transect_length_m).toEqual({ min: 0, max: 500 })
  })
})
