// CSV for a whole table, written against a column list rather than the keys of
// whatever rows came back.
//
// The dive-log export (dive-log-csv.ts) writes a fixed, human-curated column
// set for one known shape. A database backup has neither: the columns come from
// the schema at run time, and a table with no rows still has to export its
// header — an empty file would silently lose the shape of an empty table, which
// on a restore is the difference between "this table is empty" and "this table
// is missing".
//
// Deno-import-free so the vitest suite can exercise it from Node.

/** RFC 4180 quoting: quote only when the cell needs it, double any quote. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s: string
  if (typeof value === 'string') s = value
  // jsonb / arrays / composite values arrive as objects. JSON keeps them
  // faithful — and re-readable — where String() would flatten them to
  // "[object Object]".
  else if (typeof value === 'object') s = JSON.stringify(value)
  else s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * One CSV document for `rows`, with `columns` as both the header and the
 * projection: a column missing from a row exports empty, and a key present in
 * the row but absent from `columns` is dropped rather than shifting the row out
 * of alignment with its header.
 */
export function buildTableCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines: string[] = [columns.map(csvCell).join(',')]
  for (const row of rows) {
    lines.push(columns.map(c => csvCell(row[c])).join(','))
  }
  // CRLF — Excel on Windows prefers it; every other reader tolerates it.
  return lines.join('\r\n') + '\r\n'
}
