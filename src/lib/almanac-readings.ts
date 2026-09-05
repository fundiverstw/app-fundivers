/**
 * One almanac record reduced to label/value pairs.
 *
 * Shared by the day-by-day history, the staff review queue, the site/date
 * report and a diver's own entries, so a reading is worded and formatted the
 * same wherever it is read — including on the screen where the diver checks
 * their own submission against what they remember.
 */
import { t } from '../i18n'
import type {
  AlmanacEventRecord, AlmanacOwnRecord, AlmanacPendingRecord,
} from '../types/database'

export function formatNum(v: number | null, decimals = 1): string {
  return v === null ? '—' : v.toFixed(decimals)
}

/** The readings a record carries, as label/value pairs — blank ones dropped. */
export type Reading = { label: string; value: string }

export function readingsOf(
  record: AlmanacEventRecord | AlmanacPendingRecord | AlmanacOwnRecord,
): Reading[] {
  const readings: Reading[] = []
  const push = (label: string, value: string | null) => {
    if (value !== null) readings.push({ label, value })
  }
  push(t.almanac.airTemp, record.air_temp_c === null ? null : `${formatNum(record.air_temp_c)}°C`)
  push(t.almanac.waterTemp, record.water_temp_c === null ? null : `${formatNum(record.water_temp_c)}°C`)
  push(t.almanac.visibility, record.visibility_m === null ? null : `${formatNum(record.visibility_m)}m`)
  push(t.almanac.current, record.current_strength && t.almanac.currentStrengths[record.current_strength])
  push(t.almanac.weather, record.weather && t.almanac.weathers[record.weather])
  push(t.almanac.waveHeight, record.wave_height_m === null ? null : `${formatNum(record.wave_height_m)}m`)
  push(t.almanac.wavePeriod, record.wave_period_s === null ? null : `${formatNum(record.wave_period_s)}s`)
  push(t.almanac.coralHealth, record.coral_health && t.almanac.coralHealths[record.coral_health])
  push(t.almanac.wildlife, record.wildlife?.length ? record.wildlife.join(', ') : null)
  push(t.almanac.elevation, record.elevation_m === null ? null : `${record.elevation_m}m`)
  push(t.almanac.routeCondition, record.route_condition && t.almanac.routeConditions[record.route_condition])
  push(t.almanac.summitVisible, record.summit_visible === null
    ? null
    : record.summit_visible ? t.almanac.yes : t.almanac.no)
  // The band is the answer; a count, where a pre-band record carries one, is
  // extra precision printed beside it rather than a reading of its own.
  push(t.almanac.trashAmount, record.trash_band === null
    ? null
    : record.trash_count === null || record.trash_count === 0
      ? t.almanac.trashBands[record.trash_band]
      : `${t.almanac.trashBands[record.trash_band]} (${t.almanac.trashCounted(record.trash_count)})`)
  push(t.almanac.trashKindsLabel, record.trash_kinds?.length
    ? record.trash_kinds.map(k => t.almanac.trashKinds[k]).join(', ')
    : null)
  return readings
}
