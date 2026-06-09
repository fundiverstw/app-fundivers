// Pure helpers backing the typeable DateField (src/components/DateField.tsx).
// Kept here so they're unit-testable and don't break the component file's
// fast-refresh contract (a component file should only export components).

const NON_DIGIT = /\D/g

// Insert the dashes as the user types: 8 digits → 'YYYY-MM-DD'.
export function maskYmd(raw: string): string {
  const d = raw.replace(NON_DIGIT, '').slice(0, 8)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
}

// True only for a real calendar date in 'YYYY-MM-DD' form (rejects e.g.
// 2026-02-30). Used to decide when a typed value is complete enough to emit.
export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
