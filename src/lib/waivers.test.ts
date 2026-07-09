import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  globalRuleMatches, requiredWaiversForEvent, isSignatureCurrent, missingWaivers,
  annualWaiverStatus, annualWaivers, fetchWaivers,
  fetchEventWaiverOverrides, fetchDiverSignatures, fetchSignaturesForDivers,
  signWaiver, setEventWaiverOverride, type WaiverEventRef, type WaiverOverride,
} from './waivers'
import type { WaiverDef } from '../config/waivers'
import { supabase } from './supabase'
import type { WaiverSignature } from '../types/database'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>
beforeEach(() => { from.mockReset(); rpc.mockReset() })

// The catalog (formerly src/config/waivers.ts, now the `waivers` DB table); the
// pure rule helpers take it as a parameter. Bodies are irrelevant to the rules.
const PADI: WaiverDef = { code: 'padi_liability', title: 'Boat Travel & Scuba Diving Liability Release', cadence: 'annual', version: 1, appliesTo: 'dives', body: 'x' }
const MEDICAL: WaiverDef = { code: 'diver_medical', title: 'Diver Medical Questionnaire', cadence: 'annual', version: 1, appliesTo: 'none', body: 'x' }
const CE: WaiverDef = { code: 'continuing_education', title: 'Continuing Education Liability Release', cadence: 'per_event', version: 1, appliesTo: 'courses', courseColors: ['ow', 'aow', 'rescue', 'specialty'], body: 'x' }
const CATALOG: WaiverDef[] = [PADI, MEDICAL, CE]

const dive: WaiverEventRef = { id: 'D1', type: 'dive', title: 'Longdong shore dive' }
const owCourse: WaiverEventRef = { id: 'C1', type: 'course', title: 'Open Water Course' }
const tryDive: WaiverEventRef = { id: 'C2', type: 'course', title: 'Discover Scuba (Try Dive)' }

const now = new Date('2026-06-30T00:00:00Z')
const sig = (over: Partial<WaiverSignature>): WaiverSignature => ({
  id: 's', created_at: '', diver_id: 'u1', waiver_code: 'x', waiver_version: 1,
  signed_name: 'Jane', signed_at: now.toISOString(), event_id: null, ...over,
})

describe('globalRuleMatches', () => {
  it('applies dive liability to dives only', () => {
    expect(globalRuleMatches(PADI, dive)).toBe(true)
    expect(globalRuleMatches(PADI, owCourse)).toBe(false)
  })
  it('never auto-applies the medical waiver (opt-in per event)', () => {
    expect(globalRuleMatches(MEDICAL, dive)).toBe(false)
    expect(globalRuleMatches(MEDICAL, owCourse)).toBe(false)
    expect(globalRuleMatches(MEDICAL, tryDive)).toBe(false)
  })
  it('applies continuing-ed to real courses but not Try-Dive/DSD', () => {
    expect(globalRuleMatches(CE, owCourse)).toBe(true)
    expect(globalRuleMatches(CE, tryDive)).toBe(false)
    expect(globalRuleMatches(CE, dive)).toBe(false)
  })
})

describe('requiredWaiversForEvent', () => {
  it('combines matching global rules', () => {
    expect(requiredWaiversForEvent(dive, [], CATALOG).map(w => w.code)).toEqual(['padi_liability'])
    expect(requiredWaiversForEvent(owCourse, [], CATALOG).map(w => w.code)).toEqual(['continuing_education'])
    expect(requiredWaiversForEvent(tryDive, [], CATALOG).map(w => w.code)).toEqual([])
  })
  it('drops an exempted waiver', () => {
    const ov: WaiverOverride[] = [{ waiver_code: 'continuing_education', mode: 'exempt' }]
    expect(requiredWaiversForEvent(owCourse, ov, CATALOG).map(w => w.code)).toEqual([])
  })
  it('adds a required waiver the rule would not include', () => {
    const ov: WaiverOverride[] = [{ waiver_code: 'diver_medical', mode: 'require' }]
    expect(requiredWaiversForEvent(tryDive, ov, CATALOG).map(w => w.code))
      .toEqual(['diver_medical'])
  })
})

describe('isSignatureCurrent', () => {
  it('honors the annual window', () => {
    const fresh = sig({ waiver_code: 'diver_medical', signed_at: '2026-06-01T00:00:00Z' })
    const stale = sig({ waiver_code: 'diver_medical', signed_at: '2025-06-01T00:00:00Z' })
    expect(isSignatureCurrent(MEDICAL, fresh, dive, now)).toBe(true)
    expect(isSignatureCurrent(MEDICAL, stale, dive, now)).toBe(false)
  })
  it('treats an older version as not current', () => {
    const v0 = sig({ waiver_code: 'diver_medical', waiver_version: 0 })
    expect(isSignatureCurrent(MEDICAL, v0, dive, now)).toBe(false)
  })
  it('ties a per-event signature to its exact event', () => {
    const forC1 = sig({ waiver_code: 'continuing_education', event_id: 'C1' })
    const forOther = sig({ waiver_code: 'continuing_education', event_id: 'C9' })
    expect(isSignatureCurrent(CE, forC1, owCourse, now)).toBe(true)
    expect(isSignatureCurrent(CE, forOther, owCourse, now)).toBe(false)
  })
  it('ignores the annual time window for per-event waivers', () => {
    const old = sig({ waiver_code: 'continuing_education', event_id: 'C1', signed_at: '2020-01-01T00:00:00Z' })
    expect(isSignatureCurrent(CE, old, owCourse, now)).toBe(true)
  })
})

describe('missingWaivers', () => {
  it('returns only the unsatisfied required waivers', () => {
    // Medical is opt-in, so requiring it per-event gives a dive two required
    // waivers; signing only liability leaves medical outstanding.
    const ov: WaiverOverride[] = [{ waiver_code: 'diver_medical', mode: 'require' }]
    const signatures = [sig({ waiver_code: 'padi_liability', signed_at: '2026-06-01T00:00:00Z' })]
    expect(missingWaivers(dive, ov, signatures, now, CATALOG).map(w => w.code)).toEqual(['diver_medical'])
  })
  it('is empty when all required waivers are current', () => {
    const signatures = [sig({ waiver_code: 'padi_liability', signed_at: '2026-06-01T00:00:00Z' })]
    expect(missingWaivers(dive, [], signatures, now, CATALOG)).toEqual([])
  })
})

describe('annualWaiverStatus', () => {
  it('reports unsigned when there is no signature', () => {
    expect(annualWaiverStatus(MEDICAL, [], now).state).toBe('unsigned')
  })
  it('reports signed with a validUntil one year out', () => {
    const s = annualWaiverStatus(MEDICAL, [sig({ waiver_code: 'diver_medical', signed_at: '2026-06-01T00:00:00Z' })], now)
    expect(s.state).toBe('signed')
    expect(s.validUntil).toBe(new Date('2027-06-01T00:00:00Z').toISOString())
  })
  it('reports expired past the window', () => {
    expect(annualWaiverStatus(MEDICAL, [sig({ waiver_code: 'diver_medical', signed_at: '2024-01-01T00:00:00Z' })], now).state).toBe('expired')
  })
  it('reports outdated when the signed version is behind config', () => {
    expect(annualWaiverStatus(MEDICAL, [sig({ waiver_code: 'diver_medical', waiver_version: 0 })], now).state).toBe('outdated')
  })
  it('lists exactly the annual waivers', () => {
    expect(annualWaivers(CATALOG).map(w => w.code).sort()).toEqual(['diver_medical', 'padi_liability'])
  })
})

describe('data layer', () => {
  it('fetchWaivers maps active waiver rows to the domain shape', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [{
      id: '1', created_at: '', created_by: null, code: 'padi_liability',
      title: 'Boat Liability', language: null, body: 'text', pdf_path: null,
      cadence: 'annual', version: 1, applies_to: 'dives', course_colors: null, active: true,
    }] }))
    const out = await fetchWaivers()
    expect(out).toEqual([expect.objectContaining({
      code: 'padi_liability', appliesTo: 'dives', body: 'text', pdfPath: null,
    })])
  })

  it('fetchEventWaiverOverrides queries by the right event column', async () => {
    const b = mockQueryBuilder({ data: [{ waiver_code: 'continuing_education', mode: 'exempt' }] })
    const eq = vi.fn(() => b); b.eq = eq
    from.mockReturnValue(b)
    const rows = await fetchEventWaiverOverrides({ course_id: 'C1' })
    expect(eq).toHaveBeenCalledWith('event_id', 'C1')
    expect(rows).toHaveLength(1)
  })

  it('fetchDiverSignatures filters to the diver', async () => {
    const b = mockQueryBuilder({ data: [sig({})] })
    const eq = vi.fn(() => b); b.eq = eq
    from.mockReturnValue(b)
    await fetchDiverSignatures('u1')
    expect(eq).toHaveBeenCalledWith('diver_id', 'u1')
  })

  it('fetchSignaturesForDivers short-circuits on an empty list', async () => {
    expect(await fetchSignaturesForDivers([])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('signWaiver calls the RPC with the event id for a per-event waiver', async () => {
    rpc.mockResolvedValue({ data: 'sig-1', error: null })
    const id = await signWaiver({ def: CE, signedName: ' Jane Doe ', event: owCourse })
    expect(id).toBe('sig-1')
    expect(rpc).toHaveBeenCalledWith('sign_waiver', expect.objectContaining({
      p_code: 'continuing_education', p_version: CE.version,
      p_signed_name: ' Jane Doe ', p_event_id: 'C1',
    }))
  })

  it('signWaiver omits the event for an annual waiver even if one is passed', async () => {
    rpc.mockResolvedValue({ data: 'sig-2', error: null })
    await signWaiver({ def: MEDICAL, signedName: 'Jane', event: dive })
    expect(rpc).toHaveBeenCalledWith('sign_waiver', expect.objectContaining({
      p_event_id: null,
    }))
  })

  it('setEventWaiverOverride deletes then inserts when setting a mode', async () => {
    const delBuilder = mockQueryBuilder({ error: null })
    const delEq2 = vi.fn(() => Promise.resolve({ error: null }))
    const delEq1 = vi.fn(() => ({ eq: delEq2 }))
    delBuilder.delete = vi.fn(() => ({ eq: delEq1 }))
    const insert = vi.fn(() => Promise.resolve({ error: null }))
    const builder = { ...delBuilder, insert } as Record<string, unknown>
    from.mockReturnValue(builder)

    await setEventWaiverOverride({ event: owCourse, code: 'continuing_education', mode: 'exempt', createdBy: 'admin1' })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_id: 'C1', waiver_code: 'continuing_education', mode: 'exempt',
    }))
  })

  it('setEventWaiverOverride only deletes when clearing (mode null)', async () => {
    const delEq2 = vi.fn(() => Promise.resolve({ error: null }))
    const delEq1 = vi.fn(() => ({ eq: delEq2 }))
    const insert = vi.fn(() => Promise.resolve({ error: null }))
    from.mockReturnValue({ delete: vi.fn(() => ({ eq: delEq1 })), insert } as never)

    await setEventWaiverOverride({ event: owCourse, code: 'continuing_education', mode: null, createdBy: 'admin1' })
    expect(insert).not.toHaveBeenCalled()
  })
})
