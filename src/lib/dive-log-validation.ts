// Bounds for the dive-log fields.
//
// Every numeric column here is either a narrow `numeric(p,s)` or a
// CHECK-constrained integer, and neither fails gracefully: Postgres raises
// "numeric field overflow" or a constraint violation, and the diver sees the
// raw driver text with no clue which of ten boxes caused it. Five of these
// columns are numeric(3,1) — they cannot hold 100 — and two more have CHECK
// ranges the form never mentioned.
//
// The bounds below are the physical limits of recreational diving, which in
// every case sit inside what the column can hold. A value that passes here
// cannot fail there, so the DB constraints go back to being a backstop rather
// than the thing the diver actually hits.
//
// This table is the single source of truth: it drives the min/max/step on the
// inputs and the validation that runs on submit. Widening a column means
// widening the entry here, not hunting for a literal in the JSX.

import { t } from '../i18n'
import { todayIso, addIsoDays } from './dates'

export type NumericField =
  | 'max_depth_m'
  | 'dive_time_min'
  | 'visibility_m'
  | 'water_temp_c'
  | 'air_temp_c'
  | 'wave_height_m'
  | 'weight_kg'
  | 'tank_size_l'
  | 'start_pressure_bar'
  | 'end_pressure_bar'

export interface NumericBound {
  min: number
  max: number
  /** Decimal places the column keeps. 0 means the column is an integer. */
  decimals: number
}

// The columns behind these, for anyone widening a bound: max_depth_m and
// visibility_m are numeric(4,1); water_temp_c, air_temp_c, wave_height_m,
// weight_kg and tank_size_l are numeric(3,1), so 100 does not fit. dive_time_min
// is CHECK 0-480 and both pressures are CHECK 0-350.
export const DIVE_LOG_BOUNDS: Record<NumericField, NumericBound> = {
  max_depth_m:        { min: 0,   max: 200, decimals: 1 },
  dive_time_min:      { min: 0,   max: 480, decimals: 0 },
  visibility_m:       { min: 0,   max: 100, decimals: 1 },
  water_temp_c:       { min: -2,  max: 40,  decimals: 1 },
  air_temp_c:         { min: -50, max: 60,  decimals: 1 },
  wave_height_m:      { min: 0,   max: 20,  decimals: 1 },
  weight_kg:          { min: 0,   max: 50,  decimals: 1 },
  tank_size_l:        { min: 0,   max: 30,  decimals: 1 },
  start_pressure_bar: { min: 0,   max: 350, decimals: 0 },
  end_pressure_bar:   { min: 0,   max: 350, decimals: 0 },
}

export const NUMERIC_FIELDS = Object.keys(DIVE_LOG_BOUNDS) as NumericField[]

// The text columns are plain `text`, so nothing here prevents a DB error.
// These are limits on what a logbook entry is reasonably made of, and they
// stop a paste of an entire document from becoming a row.
export const DIVE_LOG_TEXT_MAX = {
  site: 120,
  weather: 60,
  buddy_name: 120,
  instructor_name: 120,
  notes: 2000,
} as const

export type TextField = keyof typeof DIVE_LOG_TEXT_MAX

// Recreational scuba starts around the Aqua-Lung; anything earlier is a typo,
// and so is anything ahead of today. The future gets a day of slack rather
// than a hard stop at the shop's today: a diver logging from a timezone east
// of the shop is legitimately already on tomorrow's date.
export const EARLIEST_DIVE_DATE = '1950-01-01'

export function latestDiveDate(): string {
  return addIsoDays(todayIso(), 1)
}

export type DiveLogField = NumericField | TextField | 'dived_on'
export type DiveLogErrors = Partial<Record<DiveLogField, string>>

type Numbers = Partial<Record<NumericField, number | null | undefined>>
type Texts = Partial<Record<TextField, string | null | undefined>>
export type ValidatableDiveLog = Numbers & Texts & { dived_on?: string | null }

/**
 * Snap each number to the decimal places its column keeps.
 *
 * Postgres rounds on the way in too, but it rounds *after* deciding the value
 * fits — so 99.96 into a numeric(3,1) becomes 100.0 and overflows a column
 * that accepted 99.9 a moment earlier. Rounding first means the value we
 * validated is the value we store.
 */
export function roundDiveLogNumbers<T extends ValidatableDiveLog>(form: T): T {
  const out: ValidatableDiveLog = { ...form }
  for (const field of NUMERIC_FIELDS) {
    const v = out[field]
    if (v == null || !Number.isFinite(v)) continue
    const factor = 10 ** DIVE_LOG_BOUNDS[field].decimals
    out[field] = Math.round(v * factor) / factor
  }
  return out as T
}

/**
 * Field-keyed messages for everything wrong with the entry, empty when it is
 * safe to send. Runs against already-rounded numbers.
 */
export function validateDiveLog(form: ValidatableDiveLog): DiveLogErrors {
  const errors: DiveLogErrors = {}
  const e = t.diveLogs.errors

  if (!form.site?.trim()) errors.site = e.siteRequired

  if (!form.dived_on) {
    errors.dived_on = e.dateRequired
  } else if (form.dived_on < EARLIEST_DIVE_DATE || form.dived_on > latestDiveDate()) {
    errors.dived_on = e.dateOutOfRange
  }

  for (const field of NUMERIC_FIELDS) {
    const v = form[field]
    if (v == null) continue
    const { min, max, decimals } = DIVE_LOG_BOUNDS[field]
    if (!Number.isFinite(v)) {
      errors[field] = e.notANumber
    } else if (v < min || v > max) {
      errors[field] = e.outOfRange(min, max)
    } else if (decimals === 0 && !Number.isInteger(v)) {
      errors[field] = e.wholeNumber
    }
  }

  for (const field of Object.keys(DIVE_LOG_TEXT_MAX) as TextField[]) {
    const v = form[field]
    if (v && v.length > DIVE_LOG_TEXT_MAX[field]) {
      errors[field] = e.tooLong(DIVE_LOG_TEXT_MAX[field])
    }
  }

  // A tank that gained pressure underwater is a transposed pair, not a dive.
  const { start_pressure_bar: start, end_pressure_bar: end } = form
  if (start != null && end != null && Number.isFinite(start) && Number.isFinite(end) && end > start) {
    errors.end_pressure_bar = e.endAboveStart
  }

  return errors
}

export function hasErrors(errors: DiveLogErrors): boolean {
  return Object.keys(errors).length > 0
}
