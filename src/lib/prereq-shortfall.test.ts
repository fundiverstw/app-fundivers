import { describe, it, expect } from 'vitest'
import { anyShortfall, parseReqDives, prereqShortfall, type EligibilityEvent, type EligibilityProfile } from './prereq-shortfall'

const LADDER = [
  { id: 'ow',      code: 'open_water',             rank: 1, padi_equivalent_id: 'ow' },
  { id: 'aow',     code: 'advanced_open_water',    rank: 2, padi_equivalent_id: 'aow' },
  { id: 'rescue',  code: 'rescue',                 rank: 3, padi_equivalent_id: 'rescue' },
  { id: 'ssi-aow', code: 'ssi_advanced_open_water', rank: 2, padi_equivalent_id: 'aow' },
  // SDI's 4th rung is PADI's 3rd: agency ranks are never compared directly.
  { id: 'sdi-msd', code: 'sdi_master_scuba_diver', rank: 4, padi_equivalent_id: 'rescue' },
]

const diver = (p: Partial<EligibilityProfile> = {}): EligibilityProfile => ({
  uncertified: false, logged_dives: 30, cert_level_code: 'advanced_open_water', nitrox_certified: false, ...p,
})
const event = (e: Partial<EligibilityEvent> = {}): EligibilityEvent => ({
  prereq_cert_id: null, req_dives: null, nitrox_required: false, ...e,
})

describe('prereqShortfall — certification', () => {
  it.each([
    ['open_water', 'aow', 'below'],
    ['advanced_open_water', 'aow', null],
    ['ssi_advanced_open_water', 'aow', null],
    ['ssi_advanced_open_water', 'rescue', 'below'],
    ['sdi_master_scuba_diver', 'rescue', null],
    ['rescue', 'ow', null],
  ] as const)('%s against %s → %s', (code, required, expected) => {
    expect(prereqShortfall(diver({ cert_level_code: code }), event({ prereq_cert_id: required }), false, LADDER).cert)
      .toBe(expected)
  })

  it('an uncertified diver falls short of any level', () => {
    expect(prereqShortfall(diver({ uncertified: true, cert_level_code: null }), event({ prereq_cert_id: 'ow' }), false, LADDER).cert)
      .toBe('uncertified')
  })

  it('no level picked is short, not a pass', () => {
    for (const code of [null, '']) {
      expect(prereqShortfall(diver({ cert_level_code: code }), event({ prereq_cert_id: 'ow' }), false, LADDER).cert)
        .toBe('unstated')
    }
  })

  it('an event asking for no level asks nothing of anyone', () => {
    expect(prereqShortfall(diver({ uncertified: true, cert_level_code: null }), event(), false, LADDER).cert).toBeNull()
  })

  it('grades nothing before the ladder has loaded', () => {
    expect(prereqShortfall(diver({ cert_level_code: 'open_water' }), event({ prereq_cert_id: 'aow' }), false, []).cert).toBeNull()
  })
})

describe('prereqShortfall — logged dives and nitrox', () => {
  it('counts logged dives, treating none entered as zero', () => {
    expect(prereqShortfall(diver({ logged_dives: 19 }), event({ req_dives: '20 dives' }), false, LADDER).dives).toBe(true)
    expect(prereqShortfall(diver({ logged_dives: 20 }), event({ req_dives: 20 }), false, LADDER).dives).toBe(false)
    expect(prereqShortfall(diver({ logged_dives: null }), event({ req_dives: 1 }), false, LADDER).dives).toBe(true)
  })

  it('needs nitrox certification or the nitrox course bought with the booking', () => {
    const ev = event({ nitrox_required: true })
    expect(prereqShortfall(diver(), ev, false, LADDER).nitrox).toBe(true)
    expect(prereqShortfall(diver({ nitrox_certified: true }), ev, false, LADDER).nitrox).toBe(false)
    expect(prereqShortfall(diver(), ev, true, LADDER).nitrox).toBe(false)
  })

  it('has nothing to say without an event', () => {
    expect(anyShortfall(prereqShortfall(diver({ uncertified: true }), null, false, LADDER))).toBe(false)
  })
})

describe('parseReqDives', () => {
  it('reads numbers and the digits of free text', () => {
    expect(parseReqDives(20)).toBe(20)
    expect(parseReqDives('20 dives')).toBe(20)
    expect(parseReqDives('none')).toBeNull()
    expect(parseReqDives(null)).toBeNull()
  })
})
