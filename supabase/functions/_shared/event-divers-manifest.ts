// Pure builders for the Taiwanese recreational-fishing-vessel passenger
// manifest (娛樂漁業漁船出海人員名冊) the dive shop hands to the boat
// operator / coast-guard before a trip. No `npm:`/`jsr:` imports so the
// mapping + row logic is unit-testable under vitest; the SheetJS
// serialization lives in event-divers-xlsx.ts.
//
// The sheet is Chinese to match the official form (the app is otherwise
// English-only — these are output data values, not UI strings). Gender and
// country are localized to Chinese where we recognize the (free-text)
// profile value, and fall back to the raw value untouched so an unmapped
// or garbage entry still appears for the admin to fix by hand.

export interface EventDiverRow {
  /** Legal name exactly as on the diver's passport / ID — the 姓名 column. */
  name: string
  /** YYYY-MM-DD or null. */
  dob: string | null
  /** Free-text nationality from the profile (e.g. "American", "Taiwanese"). */
  nationality: string | null
  /** ID card / passport number. */
  idNumber: string | null
  /** Free-text gender from the profile (e.g. "male"). */
  gender: string | null
  /** Free-text certification level (e.g. "AOW", "Divemaster"). */
  certLevel: string | null
  /** Total logged dives. */
  loggedDives: number | null
  /** Optional 備註 (remark) text — used to flag a staff member's role
   *  (e.g. 教練). Booked divers leave this blank. */
  remark?: string | null
}

export interface BoatManifestConfig {
  /** Vessel name, e.g. "坤成8號". May be empty. */
  boatName: string
  /** Vessel registration, e.g. "CT2-6445". May be empty. */
  registration: string
  /** Footer instruction lines, each rendered as its own row. */
  notes: string[]
}

// Fixed title suffix of the official form. Prepended with the (configurable)
// boat name + registration at export time.
export const MANIFEST_TITLE_SUFFIX = '娛樂漁業漁船出海人員名冊'

// Column headers, matching the official form left-to-right.
export const MANIFEST_HEADERS = [
  '編號',
  '姓名',
  '身分證字號（護照號碼）',
  '出生(民國)年月日',
  '性別',
  '潛水執照等級',
  '潛水總支數',
  '國家',
  '備註',
] as const

export const MANIFEST_SHEET_NAME = '出海人員名冊'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// 'YYYY-MM-DD' → 'Mar 4,1980' (matching the example sheet's format —
// Gregorian English month, no space after the comma). Returns the raw
// string if it doesn't parse, '' if absent.
export function formatManifestDob(yyyyMmDd: string | null): string {
  if (!yyyyMmDd) return ''
  const d = new Date(yyyyMmDd + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return yyyyMmDd
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()},${d.getUTCFullYear()}`
}


// male → 男, female → 女. Unknown / free-text values pass through untouched.
export function genderToZh(gender: string | null): string {
  const g = (gender ?? '').trim().toLowerCase()
  if (g === 'm' || g === 'male' || g === 'man') return '男'
  if (g === 'f' || g === 'female' || g === 'woman') return '女'
  return (gender ?? '').trim()
}

// Nationality → Chinese country name. The alias table is shared with the app's
// BI panes (src/lib/nationality.ts), so "USA" and "United States" collapse the
// same way on the manifest as they do on the dashboard — one table, one answer.
// Anything unrecognized falls through as the raw trimmed value so the row still
// renders and the admin can correct it.
import { nationalityToZh } from "../../../src/lib/nationality.ts"
export { nationalityToZh }

// Duty role → Chinese label for the 備註 column when a staff member is on the
// manifest. instructor → 教練, guide → 導潛, support → 支援. Unknown / empty
// values pass through untouched so an unmapped role still renders.
export function roleToZh(role: string | null): string {
  switch ((role ?? '').trim().toLowerCase()) {
    case 'instructor': return '教練'
    case 'guide':      return '導潛'
    case 'support':    return '支援'
    default:           return (role ?? '').trim()
  }
}

// Title row text: "<boat> (<reg>) 娛樂漁業漁船出海人員名冊". Omits the
// parens when there's no registration, and the leading space when there's
// no boat name at all.
export function manifestTitle(boatName: string, registration: string): string {
  const name = (boatName ?? '').trim()
  const reg = (registration ?? '').trim()
  const prefix = [name, reg ? `(${reg})` : ''].filter(Boolean).join(' ')
  return prefix ? `${prefix} ${MANIFEST_TITLE_SUFFIX}` : MANIFEST_TITLE_SUFFIX
}

// Build the full sheet as an array-of-arrays:
//   row 0           title (merged across all columns by the serializer)
//   row 1           column headers
//   rows 2..N+1     one numbered row per diver
//   blank row
//   footer notes    one row each (merged across all columns)
export function buildManifestAoa(
  divers: EventDiverRow[],
  config: BoatManifestConfig,
): (string | number)[][] {
  const aoa: (string | number)[][] = []
  aoa.push([manifestTitle(config.boatName, config.registration)])
  aoa.push([...MANIFEST_HEADERS])

  divers.forEach((d, i) => {
    aoa.push([
      i + 1,
      (d.name ?? '').trim(),
      d.idNumber ?? '',
      formatManifestDob(d.dob),
      genderToZh(d.gender),
      (d.certLevel ?? '').trim(),
      d.loggedDives ?? '',
      nationalityToZh(d.nationality),
      (d.remark ?? '').trim(),
    ])
  })

  const notes = (config.notes ?? []).map(n => n.trim()).filter(Boolean)
  if (notes.length) {
    aoa.push([])
    for (const note of notes) aoa.push([note])
  }

  return aoa
}
