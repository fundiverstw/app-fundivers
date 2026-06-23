import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import type { TripReferral } from '../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

let lastUpdate: Record<string, unknown> | null
beforeEach(() => { from.mockReset(); lastUpdate = null })

function ref(over: Partial<TripReferral> = {}): TripReferral {
  return {
    id: 'r1', created_at: '2026-06-10T00:00:00Z', trip_id: 't1', diver_id: 'u1',
    referral_code: 'FD-7K2MQ4', status: 'interested', booked_amount: null, booked_currency: null,
    kickback_rate: null, kickback_amount: null, kickback_status: 'pending', received_at: null,
    admin_notes: null, ...over,
  }
}

describe('fetchReferralsWithDivers', () => {
  it('joins each referral to its diver contact row', async () => {
    const refs = [ref(), ref({ id: 'r2', diver_id: 'u2' })]
    const profiles = [
      { id: 'u1', name: 'Ada', nickname: 'Ada', email: 'ada@x.test', contact_id: '0900' },
      { id: 'u2', name: 'Bo', nickname: 'Bo', email: 'bo@x.test', contact_id: '0901' },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'trip_referrals') return mockQueryBuilder({ data: refs })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      throw new Error(`unexpected table ${table}`)
    })
    const { fetchReferralsWithDivers } = await import('./trip-referrals')
    const out = await fetchReferralsWithDivers()
    expect(out).toHaveLength(2)
    expect(out[0].diver?.name).toBe('Ada')
    expect(out[1].diver?.email).toBe('bo@x.test')
  })

  it('skips the profile lookup entirely when there are no referrals', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'trip_referrals') return mockQueryBuilder({ data: [] })
      throw new Error(`should not query ${table}`)
    })
    const { fetchReferralsWithDivers } = await import('./trip-referrals')
    expect(await fetchReferralsWithDivers()).toEqual([])
  })
})

describe('summarizeKickbacks', () => {
  it('splits received vs outstanding kickback per currency, ignoring unconverted referrals', async () => {
    const { summarizeKickbacks } = await import('./trip-referrals')
    const rows = [
      // received TWD 3000
      { ...ref({ status: 'completed', kickback_status: 'received', booked_currency: 'TWD', kickback_amount: 3000 }), diver: null },
      // outstanding TWD 2000 (booked, invoiced)
      { ...ref({ status: 'booked', kickback_status: 'invoiced', booked_currency: 'TWD', kickback_amount: 2000 }), diver: null },
      // outstanding USD 150 (booked, pending)
      { ...ref({ status: 'booked', kickback_status: 'pending', booked_currency: 'USD', kickback_amount: 150 }), diver: null },
      // not converted — no kickback_amount — ignored
      { ...ref({ status: 'interested', kickback_amount: null }), diver: null },
    ]
    expect(summarizeKickbacks(rows)).toEqual([
      { currency: 'TWD', received: 3000, outstanding: 2000 },
      { currency: 'USD', received: 0, outstanding: 150 },
    ])
  })

  it('returns an empty list when nothing has converted', async () => {
    const { summarizeKickbacks } = await import('./trip-referrals')
    expect(summarizeKickbacks([{ ...ref(), diver: null }])).toEqual([])
  })
})

describe('recordReferralBooking', () => {
  it('writes booked status + snapshot rate', async () => {
    from.mockImplementation(() => ({
      update: (p: Record<string, unknown>) => { lastUpdate = p; return { eq: () => Promise.resolve({ error: null }) } },
    }))
    const { recordReferralBooking } = await import('./trip-referrals')
    await recordReferralBooking({ id: 'r1', bookedAmount: 60000, bookedCurrency: 'TWD', kickbackRate: 0.05 })
    expect(lastUpdate).toMatchObject({ status: 'booked', booked_amount: 60000, booked_currency: 'TWD', kickback_rate: 0.05 })
  })
})

describe('setKickbackStatus', () => {
  beforeEach(() => {
    from.mockImplementation(() => ({
      update: (p: Record<string, unknown>) => { lastUpdate = p; return { eq: () => Promise.resolve({ error: null }) } },
    }))
  })

  it('stamps received_at when marking received', async () => {
    const { setKickbackStatus } = await import('./trip-referrals')
    await setKickbackStatus('r1', 'received')
    expect(lastUpdate?.kickback_status).toBe('received')
    expect(lastUpdate?.received_at).toBeTruthy()
  })

  it('clears received_at for non-received states', async () => {
    const { setKickbackStatus } = await import('./trip-referrals')
    await setKickbackStatus('r1', 'invoiced')
    expect(lastUpdate?.kickback_status).toBe('invoiced')
    expect(lastUpdate?.received_at).toBeNull()
  })
})
