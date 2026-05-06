import { describe, it, expect } from 'vitest'
import { buildDiveLogCsv, csvCell, DIVE_LOG_CSV_COLUMNS } from './dive-log-csv'

describe('csvCell', () => {
  it('passes plain strings through unchanged', () => {
    expect(csvCell('Green Island')).toBe('Green Island')
  })

  it('renders null and undefined as empty strings (not the literal "null")', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('coerces numbers and booleans via String()', () => {
    expect(csvCell(18.5)).toBe('18.5')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(false)).toBe('false')
  })

  it('joins arrays with "; " so commas inside the cell do not collide with the CSV separator', () => {
    expect(csvCell(['BCD', 'Wetsuit', 'Fins'])).toBe('BCD; Wetsuit; Fins')
  })

  it('quote-wraps cells containing a comma, then leaves embedded text intact', () => {
    expect(csvCell('saw a turtle, then a shark')).toBe('"saw a turtle, then a shark"')
  })

  it('quote-wraps and doubles embedded quotes per RFC 4180', () => {
    expect(csvCell('she said "watch the current"')).toBe('"she said ""watch the current"""')
  })

  it('quote-wraps cells containing newlines (multi-line notes survive Excel)', () => {
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
  })
})

describe('buildDiveLogCsv', () => {
  it('emits the canonical column header as the first row', () => {
    const csv = buildDiveLogCsv([])
    const firstLine = csv.split('\r\n')[0]
    expect(firstLine).toBe(DIVE_LOG_CSV_COLUMNS.join(','))
  })

  it('produces a header-only file when given no rows (empty-export case)', () => {
    expect(buildDiveLogCsv([])).toBe(DIVE_LOG_CSV_COLUMNS.join(',') + '\r\n')
  })

  it('uses CRLF line endings — Excel on Windows expects this', () => {
    const csv = buildDiveLogCsv([{ dive_number: 1, site: 'Wai-ao' }])
    expect(csv).toMatch(/\r\n/)
    // Two CRLF terminators: one after the header, one after the data row.
    expect(csv.match(/\r\n/g)?.length).toBe(2)
  })

  it('renders missing columns as empty cells, not "undefined"', () => {
    const csv = buildDiveLogCsv([{ dive_number: 1, site: 'Wai-ao' }])
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine.startsWith('1,2026')).toBe(false) // sanity: no date filled
    expect(dataLine).not.toContain('undefined')
    // dive_number=1, dived_on='', site='Wai-ao', then 17 empty cells.
    expect(dataLine.split(',')).toHaveLength(DIVE_LOG_CSV_COLUMNS.length)
  })

  it('preserves order of multiple rows as given (caller controls sort)', () => {
    const csv = buildDiveLogCsv([
      { dive_number: 1, site: 'A' },
      { dive_number: 2, site: 'B' },
      { dive_number: 3, site: 'C' },
    ])
    const sites = csv.split('\r\n').slice(1, 4).map(l => l.split(',')[2])
    expect(sites).toEqual(['A', 'B', 'C'])
  })

  it('keeps the gear_used array as a single CSV cell joined with "; "', () => {
    const csv = buildDiveLogCsv([{
      dive_number: 1,
      site: 'Wai-ao',
      gear_used: ['BCD', 'Wetsuit'],
    }])
    // The cell has no comma after the join, so it's not quote-wrapped.
    expect(csv).toContain('BCD; Wetsuit')
    // And we still end up with the right number of cells per row (no
    // accidental column shift from the array's commas).
    const dataLine = csv.split('\r\n')[1]
    expect(dataLine.split(',')).toHaveLength(DIVE_LOG_CSV_COLUMNS.length)
  })

  it('quote-wraps a notes cell that contains a comma', () => {
    const csv = buildDiveLogCsv([{ dive_number: 1, site: 'X', notes: 'cold, dark, fun' }])
    expect(csv).toContain('"cold, dark, fun"')
  })
})
