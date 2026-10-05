import { describe, it, expect } from 'vitest'
import { anyShortfall, parseReqDives, prereqExempt, prereqShortfall, shortfallForStep, type EligibilityEvent, type EligibilityProfile } from './prereq-shortfall'

const LADDER = [
  { id: 'ow',      code: 'open_water',              organization: 'PADI', rank: 1, padi_equivalent_id: 'ow' },
  { id: 'aow',     code: 'advanced_open_water',     organization: 'PADI', rank: 2, padi_equivalent_id: 'aow' },
  { id: 'rescue',  code: 'rescue',                  organization: 'PADI', rank: 3, padi_equivalent_id: 'rescue' },
  // A PADI row whose equivalence was never filled in is still itself.
  { id: 'dm',      code: 'divemaster',              organization: 'PADI', rank: 4, padi_equivalent_id: null },
  { id: 'ssi-aow', code: 'ssi_advanced_open_water', organization: 'SSI',  rank: 2, padi_equivalent_id: 'aow' },
  // SDI's 4th rung is PADI's 3rd: agency ranks are never compared directly.
  { id: 'sdi-msd', code: 'sdi_master_scuba_diver',  organization: 'SDI',  rank: 4, padi_equivalent_id: 'rescue' },
  // An agency level nobody has mapped to PADI, ranked high on its own ladder.
  { id: 'tdi-x',   code: 'tdi_unmapped',            organization: 'TDI',  rank: 9, padi_equivalent_id: null },
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
    ['divemaster', 'rescue', null],
    // Its own rank 9 is not a PADI rank; with no mapping, it can't be graded.
    ['tdi_unmapped', 'dm', 'unranked'],
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

describe('prereqExempt', () => {
  it('lets the shop book someone else, and admin edits, through; nobody booking themselves', () => {
    expect(prereqExempt({ privileged: true, forSomeoneElse: true })).toBe(true)
    expect(prereqExempt({ privileged: true, forSomeoneElse: false })).toBe(false)
    expect(prereqExempt({ privileged: false, forSomeoneElse: true })).toBe(false)  // a parent
    expect(prereqExempt({ privileged: false, forSomeoneElse: false, isEdit: true })).toBe(true)
  })
})

describe('shortfallForStep', () => {
  const all = { cert: 'below' as const, dives: true, nitrox: true }
  it('keeps certification and dives for step 2, nitrox for step 3, everything for the last', () => {
    expect(shortfallForStep(all, 2)).toEqual({ cert: 'below', dives: true, nitrox: false })
    expect(shortfallForStep(all, 3)).toEqual({ cert: null, dives: false, nitrox: true })
    expect(shortfallForStep(all, 'all')).toEqual(all)
  })
})

describe('parseReqDives', () => {
  it('reads numbers and the digits of free text', () => {
    expect(parseReqDives(20)).toBe(20)
    expect(parseReqDives('20 dives')).toBe(20)
    expect(parseReqDives('10-20')).toBe(10)
    expect(parseReqDives('none')).toBeNull()
    expect(parseReqDives(null)).toBeNull()
  })
})
