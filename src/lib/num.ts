// Coerce a form value (string, number, empty, null) to a number — or null when
// it's blank or unparseable. Shared by every numeric form input so the handling
// stays consistent.
//
// Strict on purpose: `Number` rather than `parseFloat`, so "12abc" is null
// rather than 12. A partly-numeric string in a form field is a typo, and
// silently keeping the numeric prefix stores a measurement nobody entered.
// Whitespace is trimmed before the check because `Number('   ')` is 0, not NaN.
export function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const text = String(v).trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}
