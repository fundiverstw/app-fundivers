import { describe, it, expect } from 'vitest'
import { csvCell, buildTableCsv, CSV_BOM } from './csv'

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Kenting')).toBe('Kenting')
    expect(csvCell(3000)).toBe('3000')
    expect(csvCell(false)).toBe('false')
  })

  it('writes null and undefined as an empty field, not as the word', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes a cell that would otherwise break the row', () => {
    expect(csvCell('Green Island, Taitung')).toBe('"Green Island, Taitung"')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""')
  })

  it('keeps jsonb readable instead of flattening it to [object Object]', () => {
    expect(csvCell({ total: 3000, deposit: 1000 })).toBe('"{""total"":3000,""deposit"":1000}"')
    expect(csvCell(['mask', 'fins'])).toBe('"[""mask"",""fins""]"')
  })
})

describe('buildTableCsv', () => {
  // Excel reads a BOM-less UTF-8 CSV as the machine's ANSI codepage, so a
  // backup of a Chinese-language table restores as mojibake without this.
  it('leads with a UTF-8 BOM so Excel reads Chinese cells correctly', () => {
    expect(buildTableCsv(['name'], [{ name: '王小明' }]).startsWith(CSV_BOM)).toBe(true)
  })

  it('exports the header even when the table is empty', () => {
    expect(buildTableCsv(['id', 'name'], [])).toBe(CSV_BOM + 'id,name\r\n')
  })

  it('projects each row through the column list', () => {
    const csv = buildTableCsv(['id', 'name', 'notes'], [
      { id: 'a1', name: 'Ada', notes: null },
      { id: 'b2', name: 'Grace', notes: 'first dive' },
    ])
    expect(csv).toBe(CSV_BOM + 'id,name,notes\r\na1,Ada,\r\nb2,Grace,first dive\r\n')
  })

  it('holds alignment when a row is missing a column or carries an extra one', () => {
    const csv = buildTableCsv(['id', 'name'], [
      { id: 'a1' },
      { id: 'b2', name: 'Grace', dropped: 'not in the header' },
    ])
    expect(csv).toBe(CSV_BOM + 'id,name\r\na1,\r\nb2,Grace\r\n')
  })
})
