// CSV builder for the dive-log email export. Pure TS so it can be tested
// from vitest. Mirrored at supabase/functions/_shared/dive-log-csv.ts —
// keep both in sync when columns change (Deno can't import across into
// src/, hence the duplication).

// Column order doubles as the CSV header row. Logbook-natural ordering
// (id/date/site → conditions → tank → people → notes).
export const DIVE_LOG_CSV_COLUMNS = [
  'dive_number',
  'dived_on',
  'site',
  'dive_type',
  'max_depth_m',
  'dive_time_min',
  'visibility_m',
  'water_temp_c',
  'air_temp_c',
  'weather',
  'wave_height_m',
  'weight_kg',
  'gear_used',
  'gas_mix',
  'tank_size_l',
  'start_pressure_bar',
  'end_pressure_bar',
  'buddy_name',
  'instructor_name',
  'notes',
] as const

export type DiveLogCsvColumn = typeof DIVE_LOG_CSV_COLUMNS[number]
export type DiveLogCsvRow = Partial<Record<DiveLogCsvColumn, unknown>>

// RFC 4180 quoting — wrap in quotes only when the cell contains a special
// char, and double any embedded quote. Arrays (gear_used) are joined with
// "; " so commas inside the cell never collide with the field separator.
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (Array.isArray(v)) s = v.map(String).join('; ')
  else s = String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildDiveLogCsv(rows: DiveLogCsvRow[]): string {
  const lines: string[] = [DIVE_LOG_CSV_COLUMNS.join(',')]
  for (const r of rows) {
    lines.push(DIVE_LOG_CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))
  }
  // CRLF — Excel on Windows prefers it; mac/linux readers tolerate it.
  return lines.join('\r\n') + '\r\n'
}
