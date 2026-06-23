// trip-admin lib: the publish-stamp rule is the only non-trivial logic
// (insert/update routing is mechanical). We assert that going live stamps
// published_at exactly once and never clobbers an existing stamp.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Trip } from '../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

// Capture the payload handed to insert()/update() so we can assert on it.
let lastInsert: Record<string, unknown> | null
let lastUpdate: Record<string, unknown> | null

beforeEach(() => {
  from.mockReset()
  lastInsert = null
  lastUpdate = null
  from.mockImplementation(() => ({
    insert: (p: Record<string, unknown>) => { lastInsert = p; return Promise.resolve({ error: null }) },
    update: (p: Record<string, unknown>) => { lastUpdate = p; return { eq: () => Promise.resolve({ error: null }) } },
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
  }))
})

const baseTrip: Trip = {
  id: 't1', created_at: '2026-06-01T00:00:00Z', partner_shop_id: 's1',
  title: 'Raja Ampat', destination: 'Indonesia', summary: null, description: null,
  start_date: null, end_date: null, price: 60000, currency: 'TWD',
  hero_image_url: null, highlights: [], booking_url: null, kickback_rate: 0.05,
  status: 'draft', published_at: null, created_by: null,
}

describe('saveTrip publish stamp', () => {
  it('stamps published_at when a new trip is created already published', async () => {
    const { saveTrip } = await import('./trip-admin')
    await saveTrip({ partner_shop_id: 's1', title: 'X', destination: 'Y', status: 'published' })
    expect(lastInsert?.published_at).toBeTruthy()
  })

  it('does not stamp a draft trip', async () => {
    const { saveTrip } = await import('./trip-admin')
    await saveTrip({ partner_shop_id: 's1', title: 'X', destination: 'Y', status: 'draft' })
    expect(lastInsert?.published_at).toBeFalsy()
  })

  it('stamps on first publish of an existing draft', async () => {
    const { saveTrip } = await import('./trip-admin')
    await saveTrip({ ...baseTrip, status: 'published' }, baseTrip)
    expect(lastUpdate?.published_at).toBeTruthy()
  })

  it('preserves the original stamp when re-saving an already-published trip', async () => {
    const { saveTrip } = await import('./trip-admin')
    const live: Trip = { ...baseTrip, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await saveTrip({ ...live, title: 'Renamed' }, live)
    expect(lastUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})

describe('setTripStatus', () => {
  it('stamps published_at the first time a draft is published', async () => {
    const { setTripStatus } = await import('./trip-admin')
    await setTripStatus(baseTrip, 'published')
    expect(lastUpdate?.status).toBe('published')
    expect(lastUpdate?.published_at).toBeTruthy()
  })

  it('keeps the stamp when archiving a published trip', async () => {
    const { setTripStatus } = await import('./trip-admin')
    const live: Trip = { ...baseTrip, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await setTripStatus(live, 'archived')
    expect(lastUpdate?.status).toBe('archived')
    expect(lastUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})

describe('savePartnerShop', () => {
  it('inserts when no id is given and updates when one is', async () => {
    const { savePartnerShop } = await import('./trip-admin')
    await savePartnerShop({ name: 'New', country: 'PH' })
    expect(lastInsert?.name).toBe('New')
    await savePartnerShop({ name: 'Edit', country: 'PH' }, 's1')
    expect(lastUpdate?.name).toBe('Edit')
  })
})
