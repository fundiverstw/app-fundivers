import { describe, it, expect } from 'vitest'
import { certSummary } from './cert-display'
import { certLevelCodePatch, effectiveCertCode, legacyCertText } from './cert-text'

const placed = { cert_level_code: 'advanced_open_water', cert_agency: 'PADI', cert_level: 'AOW' }
const legacy = { cert_level_code: null, cert_agency: 'PSAI', cert_level: 'PE40' }
const blank = { cert_level_code: null, cert_agency: null, cert_level: null }
const agencyOnly = { cert_level_code: null, cert_agency: 'PADI', cert_level: null }

describe('legacyCertText', () => {
  it('is the saved text only while no level is picked', () => {
    expect(legacyCertText(legacy)).toBe('PSAI PE40')
    expect(legacyCertText(placed)).toBeNull()
    expect(legacyCertText(blank)).toBeNull()
    // An agency alone names no level; the backfill skips it as well.
    expect(legacyCertText(agencyOnly)).toBeNull()
    // Nor text left behind on a profile marked "not certified".
    expect(legacyCertText({ ...legacy, uncertified: true })).toBeNull()
  })
})

describe('certSummary', () => {
  it('prints a picked level as is, and never lets legacy text pass for one', () => {
    expect(certSummary(placed)).toBe('PADI AOW')
    expect(certSummary(legacy)).toBe('PSAI PE40 (not on the list)')
    expect(certSummary(blank)).toBeNull()
  })
})

describe('certLevelCodePatch', () => {
  const ladder = [{ code: 'open_water' }, { code: 'advanced_open_water' }]
  it('sends a listed code, clears on "not certified" or nothing picked', () => {
    expect(certLevelCodePatch('open_water', false, ladder)).toEqual({ cert_level_code: 'open_water', uncertified: false })
    expect(certLevelCodePatch('open_water', true, ladder)).toEqual({ cert_level_code: null })
    expect(certLevelCodePatch('', false, ladder)).toEqual({ cert_level_code: null })
  })

  // A code renamed or removed since the session loaded would fail the FK.
  it('leaves off a code the ladder does not list, so the profile keeps its own', () => {
    expect(certLevelCodePatch('tdi_nitrox', false, ladder)).toEqual({})
    expect(certLevelCodePatch('open_water', false, [])).toEqual({})
  })
})

describe('effectiveCertCode', () => {
  it('is the patch\'s code when it carries one, the stored one when it is left off', () => {
    expect(effectiveCertCode({ cert_level_code: 'rescue' }, 'open_water')).toBe('rescue')
    expect(effectiveCertCode({ cert_level_code: null }, 'open_water')).toBeNull()
    expect(effectiveCertCode({}, 'open_water')).toBe('open_water')
    expect(effectiveCertCode({}, undefined)).toBeNull()
  })
})
