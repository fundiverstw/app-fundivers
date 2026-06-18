import { describe, it, expect } from 'vitest'
import { canonicalCertLevel } from './cert-level'

describe('canonicalCertLevel', () => {
  it('collapses Advanced Open Water spellings', () => {
    for (const v of ['AOW', 'aow', 'Advanced Open Water', 'Advanced Open Water Diver', 'advanced open water']) {
      expect(canonicalCertLevel(v)).toBe('Advanced Open Water')
    }
  })

  it('collapses Open Water spellings', () => {
    for (const v of ['OW', 'Open Water', 'Open Water Diver']) {
      expect(canonicalCertLevel(v)).toBe('Open Water')
    }
  })

  it('collapses Rescue and Divemaster variants', () => {
    expect(canonicalCertLevel('RESCUE')).toBe('Rescue')
    expect(canonicalCertLevel('rescue diver')).toBe('Rescue')
    expect(canonicalCertLevel('DM')).toBe('Divemaster')
    expect(canonicalCertLevel('Divemaster')).toBe('Divemaster')
  })

  it('passes through unknown / empty values trimmed', () => {
    expect(canonicalCertLevel('  Advanced Scuba Diver ')).toBe('Advanced Scuba Diver')
    expect(canonicalCertLevel('')).toBe('')
    expect(canonicalCertLevel(null)).toBe('')
    expect(canonicalCertLevel(undefined)).toBe('')
  })
})
