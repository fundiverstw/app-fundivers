import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  globalRuleMatches, requiredWaiversForEvent, isSignatureCurrent, missingWaivers,
  annualWaiverStatus, annualWaivers,
  fetchEventWaiverOverrides, fetchDiverSignatures, fetchSignaturesForDivers,
  signWaiver, setEventWaiverOverride, type WaiverEventRef, type WaiverOverride,
} from './waivers'
import { waiverByCode } from '../config/waivers'
import { supabase } from './supabase'
import type { WaiverSignature } from '../types/database'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>
beforeEach(() => { from.mockReset(); rpc.mockReset() })

const PADI = waiverByCode('padi_liability')!
const MEDICAL = waiverByCode('diver_medical')!
const CE = waiverByCode('continuing_education')!

const dive: WaiverEventRef = { id: 'D1', type: 'dive', title: 'Longdong shore dive' }
const owCourse: WaiverEventRef = { id: 'C1', type: 'course', title: 'Open Water Course' }
const tryDive: WaiverEventRef = { id: 'C2', type: 'course', title: 'Discover Scuba (Try Dive)' }

const now = new Date('2026-06-30T00:00:00Z')
const sig = (over: Partial<WaiverSignature>): WaiverSignature => ({
  id: 's', created_at: '', diver_id: 'u1', waiver_code: 'x', waiver_version: 1,
  signed_name: 'Jane', signed_at: now.toISOString(), eo_dive_id: null, eo_course_id: null, ...over,
})

describe('globalRuleMatches', () => {
  it('applies dive liability to dives only', () => {
    expect(globalRuleMatches(PADI, dive)).toBe(true)
    expect(globalRuleMatches(PADI, owCourse)).toBe(false)
  })
  it('applies the medical waiver to every event', () => {
    expect(globalRuleMatches(MEDICAL, dive)).toBe(true)
    expect(globalRuleMatches(MEDICAL, owCourse)).toBe(true)
    expect(globalRuleMatches(MEDICAL, tryDive)).toBe(true)
  })
  it('applies continuing-ed to real courses but not Try-Dive/DSD', () => {
    expect(globalRuleMatches(CE, owCourse)).toBe(true)
    expect(globalRuleMatches(CE, tryDive)).toBe(false)
    expect(globalRuleMatches(CE, dive)).toBe(false)
  })
})

describe('requiredWaiversForEvent', () => {
  it('combines matching global rules', () => {
    expect(requiredWaiversForEvent(dive, []).map(w => w.code)).toEqual(['padi_liability', 'diver_medical'])
    expect(requiredWaiversForEvent(owCourse, []).map(w => w.code)).toEqual(['diver_medical', 'continuing_education'])
    expect(requiredWaiversForEvent(tryDive, []).map(w => w.code)).toEqual(['diver_medical'])
  })
  it('drops an exempted waiver', () => {
    const ov: WaiverOverride[] = [{ waiver_code: 'continuing_education', mode: 'exempt' }]
    expect(requiredWaiversForEvent(owCourse, ov).map(w => w.code)).toEqual(['diver_medical'])
  })
  it('adds a required waiver the rule would not include', () => {
    const ov: WaiverOverride[] = [{ waiver_code: 'continuing_education', mode: 'require' }]
    expect(requiredWaiversForEvent(tryDive, ov).map(w => w.code))
      .toEqual(['diver_medical', 'continuing_education'])
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
    const forC1 = sig({ waiver_code: 'continuing_education', eo_course_id: 'C1' })
    const forOther = sig({ waiver_code: 'continuing_education', eo_course_id: 'C9' })
    expect(isSignatureCurrent(CE, forC1, owCourse, now)).toBe(true)
    expect(isSignatureCurrent(CE, forOther, owCourse, now)).toBe(false)
  })
  it('ignores the annual time window for per-event waivers', () => {
    const old = sig({ waiver_code: 'continuing_education', eo_course_id: 'C1', signed_at: '2020-01-01T00:00:00Z' })
    expect(isSignatureCurrent(CE, old, owCourse, now)).toBe(true)
  })
})

describe('missingWaivers', () => {
  it('returns only the unsatisfied required waivers', () => {
    const signatures = [sig({ waiver_code: 'padi_liability', signed_at: '2026-06-01T00:00:00Z' })]
    expect(missingWaivers(dive, [], signatures, now).map(w => w.code)).toEqual(['diver_medical'])
  })
  it('is empty when all required waivers are current', () => {
    const signatures = [
      sig({ waiver_code: 'padi_liability', signed_at: '2026-06-01T00:00:00Z' }),
      sig({ waiver_code: 'diver_medical', signed_at: '2026-06-01T00:00:00Z' }),
    ]
    expect(missingWaivers(dive, [], signatures, now)).toEqual([])
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
    expect(annualWaivers().map(w => w.code).sort()).toEqual(['diver_medical', 'padi_liability'])
  })
})

describe('data layer', () => {
  it('fetchEventWaiverOverrides queries by the right event column', async () => {
    const b = mockQueryBuilder({ data: [{ waiver_code: 'continuing_education', mode: 'exempt' }] })
    const eq = vi.fn(() => b); b.eq = eq
    from.mockReturnValue(b)
    const rows = await fetchEventWaiverOverrides({ course_id: 'C1' })
    expect(eq).toHaveBeenCalledWith('eo_course_id', 'C1')
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

  it('signWaiver calls the RPC with the course id for a per-event waiver', async () => {
    rpc.mockResolvedValue({ data: 'sig-1', error: null })
    const id = await signWaiver({ def: CE, signedName: ' Jane Doe ', event: owCourse })
    expect(id).toBe('sig-1')
    expect(rpc).toHaveBeenCalledWith('sign_waiver', expect.objectContaining({
      p_code: 'continuing_education', p_version: CE.version,
      p_signed_name: ' Jane Doe ', p_dive_id: null, p_course_id: 'C1',
    }))
  })

  it('signWaiver omits the event for an annual waiver even if one is passed', async () => {
    rpc.mockResolvedValue({ data: 'sig-2', error: null })
    await signWaiver({ def: MEDICAL, signedName: 'Jane', event: dive })
    expect(rpc).toHaveBeenCalledWith('sign_waiver', expect.objectContaining({
      p_dive_id: null, p_course_id: null,
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
      eo_course_id: 'C1', eo_dive_id: null, waiver_code: 'continuing_education', mode: 'exempt',
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
