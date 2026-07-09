import { describe, it, expect } from 'vitest'
import { rowToWaiverDef, ANNUAL_WAIVER_VALID_DAYS } from './waivers'
import type { WaiverRow } from '../types/database'

// The waiver catalog + its validation now live in the DB (see the `waivers`
// table CHECK constraints, exercised in tests/integration/waivers.test.ts). Here
// we only cover the row → domain mapper the app reads through.

const row = (over: Partial<WaiverRow>): WaiverRow => ({
  id: '1', created_at: '', created_by: null, code: 'c', title: 'T',
  language: null, body: 'b', pdf_path: null, cadence: 'annual', version: 1,
  applies_to: 'none', course_colors: null, active: true, ...over,
})

describe('rowToWaiverDef', () => {
  it('maps snake_case columns to the camelCase domain shape', () => {
    const def = rowToWaiverDef(row({
      code: 'padi_liability', applies_to: 'dives', course_colors: ['ow'], body: 'text',
    }))
    expect(def).toMatchObject({
      code: 'padi_liability', appliesTo: 'dives', courseColors: ['ow'], body: 'text', pdfPath: null,
    })
  })

  it('carries a PDF waiver through with a null body', () => {
    const def = rowToWaiverDef(row({ body: null, pdf_path: 'w/1.pdf' }))
    expect(def.pdfPath).toBe('w/1.pdf')
    expect(def.body).toBeNull()
  })

  it('leaves courseColors undefined when the column is null', () => {
    expect(rowToWaiverDef(row({ course_colors: null })).courseColors).toBeUndefined()
  })
})

describe('waiver constants', () => {
  it('keeps the annual validity window at one year', () => {
    expect(ANNUAL_WAIVER_VALID_DAYS).toBe(365)
  })
})
