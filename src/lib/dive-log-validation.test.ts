import { describe, it, expect } from 'vitest'
import {
  DIVE_LOG_BOUNDS, DIVE_LOG_TEXT_MAX, NUMERIC_FIELDS, EARLIEST_DIVE_DATE, latestDiveDate,
  validateDiveLog, roundDiveLogNumbers, hasErrors,
} from './dive-log-validation'
import { addIsoDays, todayIso } from './dates'

const valid = { site: 'Long Dong Bay', dived_on: '2026-04-30' }

describe('DIVE_LOG_BOUNDS', () => {
  // The whole point of the table is that it is narrower than the column, so a
  // value the form accepts can never reach Postgres as an overflow.
  const COLUMN_CEILING: Record<string, number> = {
    max_depth_m: 999.9, visibility_m: 999.9,
    water_temp_c: 99.9, air_temp_c: 99.9, wave_height_m: 99.9,
    weight_kg: 99.9, tank_size_l: 99.9,
    dive_time_min: 480, start_pressure_bar: 350, end_pressure_bar: 350,
  }

  it('never lets a field exceed what its column can hold', () => {
    for (const field of NUMERIC_FIELDS) {
      const { min, max } = DIVE_LOG_BOUNDS[field]
      expect(Math.abs(max), field).toBeLessThanOrEqual(COLUMN_CEILING[field])
      expect(Math.abs(min), field).toBeLessThanOrEqual(COLUMN_CEILING[field])
      expect(min, field).toBeLessThan(max)
    }
  })
})

describe('validateDiveLog', () => {
  it('accepts an entry with nothing but the required site', () => {
    expect(validateDiveLog(valid)).toEqual({})
  })

  it('accepts a fully populated, plausible dive', () => {
    expect(validateDiveLog({
      site: 'Batcave', dived_on: '2026-04-30',
      max_depth_m: 18.5, dive_time_min: 42, visibility_m: 12,
      water_temp_c: 26.5, air_temp_c: 31, wave_height_m: 0.5, weight_kg: 6,
      tank_size_l: 11.1, start_pressure_bar: 200, end_pressure_bar: 60,
      buddy_name: 'Alice', instructor_name: 'Bob', notes: 'Turtles.',
    })).toEqual({})
  })

  it('requires a site', () => {
    expect(validateDiveLog({}).site).toBeTruthy()
    expect(validateDiveLog({ site: '   ' }).site).toBeTruthy()
  })

  it('requires a date', () => {
    expect(validateDiveLog({ site: 'Batcave' }).dived_on).toBeTruthy()
    expect(validateDiveLog({ site: 'Batcave', dived_on: '' }).dived_on).toBeTruthy()
  })

  it('rejects a mistyped year in either direction', () => {
    // A stray 9 puts the dive in 9999, where it pins itself to the top of the
    // list forever. Everything else in the form is bounded; this was not.
    expect(validateDiveLog({ ...valid, dived_on: '9999-01-01' }).dived_on).toBeTruthy()
    expect(validateDiveLog({ ...valid, dived_on: '1899-01-01' }).dived_on).toBeTruthy()
  })

  it('accepts the boundary dates themselves', () => {
    expect(validateDiveLog({ ...valid, dived_on: EARLIEST_DIVE_DATE }).dived_on).toBeUndefined()
    expect(validateDiveLog({ ...valid, dived_on: latestDiveDate() }).dived_on).toBeUndefined()
  })

  it('tolerates today being tomorrow east of the shop, but not a real future date', () => {
    // A diver logging from a timezone ahead of the shop is legitimately on the
    // next calendar day; a week out is a typo.
    expect(validateDiveLog({ ...valid, dived_on: todayIso() }).dived_on).toBeUndefined()
    expect(validateDiveLog({ ...valid, dived_on: addIsoDays(todayIso(), 1) }).dived_on).toBeUndefined()
    expect(validateDiveLog({ ...valid, dived_on: addIsoDays(todayIso(), 7) }).dived_on).toBeTruthy()
  })

  it('treats a blank number as not-entered rather than zero', () => {
    // Every numeric field is optional; null must survive validation untouched.
    const allNull = Object.fromEntries(NUMERIC_FIELDS.map(f => [f, null]))
    expect(validateDiveLog({ ...valid, ...allNull })).toEqual({})
  })

  // The reported bug: repeating 9s in every box. Each of these lands inside a
  // numeric(3,1) or numeric(4,1) and used to reach Postgres as "numeric field
  // overflow" with no indication of which box was at fault.
  it('rejects repeating 9s in every numeric field at once', () => {
    const nines = Object.fromEntries(NUMERIC_FIELDS.map(f => [f, 999]))
    const errors = validateDiveLog({ ...valid, ...nines })
    for (const field of NUMERIC_FIELDS) {
      expect(errors[field], field).toBeTruthy()
    }
  })

  it('rejects a value one step past each maximum', () => {
    for (const field of NUMERIC_FIELDS) {
      const { max } = DIVE_LOG_BOUNDS[field]
      expect(validateDiveLog({ ...valid, [field]: max + 1 })[field], field).toBeTruthy()
      expect(validateDiveLog({ ...valid, [field]: max })[field], field).toBeUndefined()
    }
  })

  it('rejects a value one step below each minimum', () => {
    for (const field of NUMERIC_FIELDS) {
      const { min } = DIVE_LOG_BOUNDS[field]
      expect(validateDiveLog({ ...valid, [field]: min - 1 })[field], field).toBeTruthy()
      expect(validateDiveLog({ ...valid, [field]: min })[field], field).toBeUndefined()
    }
  })

  it('allows sub-zero water and air temperatures', () => {
    // Ice diving is a real thing; a min of 0 would have been wrong.
    expect(validateDiveLog({ ...valid, water_temp_c: -1.5, air_temp_c: -20 })).toEqual({})
  })

  it('rejects a fractional value in an integer column', () => {
    expect(validateDiveLog({ ...valid, dive_time_min: 42.5 }).dive_time_min).toBeTruthy()
    expect(validateDiveLog({ ...valid, start_pressure_bar: 200.5 }).start_pressure_bar).toBeTruthy()
    expect(validateDiveLog({ ...valid, max_depth_m: 18.5 }).max_depth_m).toBeUndefined()
  })

  it('rejects NaN and Infinity', () => {
    expect(validateDiveLog({ ...valid, max_depth_m: NaN }).max_depth_m).toBeTruthy()
    expect(validateDiveLog({ ...valid, max_depth_m: Infinity }).max_depth_m).toBeTruthy()
  })

  it('rejects a tank that gained pressure underwater', () => {
    expect(validateDiveLog({
      ...valid, start_pressure_bar: 60, end_pressure_bar: 200,
    }).end_pressure_bar).toBeTruthy()
  })

  it('allows a tank that came back at exactly what it started with', () => {
    expect(validateDiveLog({ ...valid, start_pressure_bar: 200, end_pressure_bar: 200 })).toEqual({})
  })

  it('does not compare pressures when only one was entered', () => {
    expect(validateDiveLog({ ...valid, end_pressure_bar: 200 })).toEqual({})
    expect(validateDiveLog({ ...valid, start_pressure_bar: 60 })).toEqual({})
  })

  it('caps the free-text fields', () => {
    for (const field of Object.keys(DIVE_LOG_TEXT_MAX) as (keyof typeof DIVE_LOG_TEXT_MAX)[]) {
      const max = DIVE_LOG_TEXT_MAX[field]
      expect(validateDiveLog({ ...valid, [field]: 'x'.repeat(max + 1) })[field], field).toBeTruthy()
      expect(validateDiveLog({ ...valid, [field]: 'x'.repeat(max) })[field], field).toBeUndefined()
    }
  })
})

describe('roundDiveLogNumbers', () => {
  it('snaps a one-decimal column to one decimal', () => {
    expect(roundDiveLogNumbers({ max_depth_m: 18.549 }).max_depth_m).toBe(18.5)
    expect(roundDiveLogNumbers({ water_temp_c: 26.55 }).water_temp_c).toBe(26.6)
  })

  it('snaps an integer column to a whole number', () => {
    expect(roundDiveLogNumbers({ dive_time_min: 42.6 }).dive_time_min).toBe(43)
    expect(roundDiveLogNumbers({ start_pressure_bar: 199.4 }).start_pressure_bar).toBe(199)
  })

  it('rounds before the range check, so a value that rounds up still fails', () => {
    // 39.96 fits numeric(3,1) as typed but Postgres stores it as 40.0. Rounding
    // first is what keeps the checked value and the stored value the same.
    const rounded = roundDiveLogNumbers({ ...valid, water_temp_c: 39.96 })
    expect(rounded.water_temp_c).toBe(40)
    expect(validateDiveLog(rounded)).toEqual({})

    const over = roundDiveLogNumbers({ ...valid, water_temp_c: 40.04 })
    expect(over.water_temp_c).toBe(40)
    expect(validateDiveLog(over)).toEqual({})
  })

  it('leaves blanks and text alone', () => {
    const form = { site: 'Batcave', max_depth_m: null, notes: 'x', buddy_name: undefined }
    expect(roundDiveLogNumbers(form)).toEqual(form)
  })

  it('does not mutate its input', () => {
    const form = { max_depth_m: 18.549 }
    roundDiveLogNumbers(form)
    expect(form.max_depth_m).toBe(18.549)
  })
})

describe('hasErrors', () => {
  it('is false for a clean entry and true once anything is wrong', () => {
    expect(hasErrors(validateDiveLog(valid))).toBe(false)
    expect(hasErrors(validateDiveLog({ ...valid, weight_kg: 999 }))).toBe(true)
  })
})
