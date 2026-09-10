import { describe, it, expect } from 'vitest'
import { canonicalNationality, nationalityToZh, COUNTRY_ZH, CANONICAL_COUNTRIES } from './nationality'

describe('canonicalNationality', () => {
  // The reported symptom: "USA" and "United States" sat as two bars on
  // Revenue by nationality, splitting one country's takings in half.
  it('collapses every spelling of the United States onto one label', () => {
    for (const spelling of ['USA', 'usa', 'US', 'U.S.', 'U.S.A.', 'united states', 'United States of America', 'America', 'American']) {
      expect(canonicalNationality(spelling)).toBe('United States')
    }
  })

  it('accepts a demonym as readily as the country', () => {
    expect(canonicalNationality('Taiwanese')).toBe('Taiwan')
    expect(canonicalNationality('Japanese')).toBe('Japan')
    expect(canonicalNationality('Filipino')).toBe('Philippines')
    expect(canonicalNationality('Dutch')).toBe('Netherlands')
  })

  it('folds the constituent nations of the UK together', () => {
    for (const spelling of ['UK', 'United Kingdom', 'Britain', 'British', 'England', 'Scotland', 'Welsh']) {
      expect(canonicalNationality(spelling)).toBe('United Kingdom')
    }
  })

  it('ignores case, spacing and punctuation', () => {
    expect(canonicalNationality('  hong  kong ')).toBe('Hong Kong')
    expect(canonicalNationality('R.O.C.')).toBe('Taiwan')
    expect(canonicalNationality('NEW ZEALAND')).toBe('New Zealand')
  })

  it('keeps Taiwan and China apart', () => {
    expect(canonicalNationality('Taiwan')).toBe('Taiwan')
    expect(canonicalNationality('China')).toBe('China')
    expect(canonicalNationality('Hong Kong')).toBe('Hong Kong')
  })

  // Folding an unrecognized country into "Other" would hide a diver whose
  // profile the admin could go and fix.
  it('passes an unrecognized value through, trimmed', () => {
    expect(canonicalNationality('  Latveria ')).toBe('Latveria')
    expect(canonicalNationality('???')).toBe('???')
  })

  it('is empty for an empty value', () => {
    expect(canonicalNationality('')).toBe('')
    expect(canonicalNationality('   ')).toBe('')
    expect(canonicalNationality(null)).toBe('')
    expect(canonicalNationality(undefined)).toBe('')
  })
})

describe('nationalityToZh', () => {
  it('reaches Chinese through the canonical name, not the spelling', () => {
    for (const spelling of ['USA', 'United States', 'American']) {
      expect(nationalityToZh(spelling)).toBe('美國')
    }
    expect(nationalityToZh('Taiwanese')).toBe('台灣')
  })

  it('falls back to the raw value so an unmapped row still renders', () => {
    expect(nationalityToZh('Latveria')).toBe('Latveria')
    expect(nationalityToZh(null)).toBe('')
  })

  // A country the aliases know but the Chinese table does not would render in
  // English on a form that is otherwise entirely Chinese — and the official
  // vessel manifest is the last place to discover that.
  it('has a Chinese name for every country it can canonicalize', () => {
    expect(CANONICAL_COUNTRIES.filter(c => !COUNTRY_ZH[c])).toEqual([])
  })

  it('has no Chinese entry for a country the aliases cannot reach', () => {
    expect(Object.keys(COUNTRY_ZH).filter(c => !CANONICAL_COUNTRIES.includes(c))).toEqual([])
  })
})
