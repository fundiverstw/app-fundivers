// Coerce a form value (string, number, empty, null) to a number — or null when
// it's blank or unparseable. Shared by the profile and gear-chart editors so
// numeric-input handling stays consistent.
export function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}
