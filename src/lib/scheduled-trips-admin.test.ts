// scheduled-trips-admin lib: the publish-stamp rule is the only non-trivial
// logic (insert/update routing is mechanical). We assert going live stamps
// published_at exactly once and never clobbers an existing stamp.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ScheduledTrip } from '../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

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

const base: ScheduledTrip = {
  id: 's1', created_at: '2026-06-01T00:00:00Z', title: 'Palau Liveaboard', destination: 'Palau',
  summary: null, description: null, start_date: null, end_date: null, price: 80000, currency: 'TWD',
  hero_image_url: null, highlights: [], addon_ids: [], room_type_ids: [],
  status: 'draft', published_at: null, created_by: null,
}

describe('saveScheduledTrip publish stamp', () => {
  it('stamps published_at when a new trip is created already published', async () => {
    const { saveScheduledTrip } = await import('./scheduled-trips-admin')
    await saveScheduledTrip({ title: 'X', destination: 'Y', status: 'published' })
    expect(lastInsert?.published_at).toBeTruthy()
  })

  it('does not stamp a draft trip', async () => {
    const { saveScheduledTrip } = await import('./scheduled-trips-admin')
    await saveScheduledTrip({ title: 'X', destination: 'Y', status: 'draft' })
    expect(lastInsert?.published_at).toBeFalsy()
  })

  it('passes the catalog add-on/room ids straight through on insert', async () => {
    const { saveScheduledTrip } = await import('./scheduled-trips-admin')
    await saveScheduledTrip({ title: 'X', destination: 'Y', status: 'draft', addon_ids: ['a1'], room_type_ids: ['r1'] })
    expect(lastInsert?.addon_ids).toEqual(['a1'])
    expect(lastInsert?.room_type_ids).toEqual(['r1'])
  })

  it('preserves the original stamp when re-saving an already-published trip', async () => {
    const { saveScheduledTrip } = await import('./scheduled-trips-admin')
    const live: ScheduledTrip = { ...base, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await saveScheduledTrip({ ...live, title: 'Renamed' }, live)
    expect(lastUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})

describe('setScheduledTripStatus', () => {
  it('stamps published_at the first time a draft is published', async () => {
    const { setScheduledTripStatus } = await import('./scheduled-trips-admin')
    await setScheduledTripStatus(base, 'published')
    expect(lastUpdate?.status).toBe('published')
    expect(lastUpdate?.published_at).toBeTruthy()
  })

  it('keeps the stamp when archiving a published trip', async () => {
    const { setScheduledTripStatus } = await import('./scheduled-trips-admin')
    const live: ScheduledTrip = { ...base, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await setScheduledTripStatus(live, 'archived')
    expect(lastUpdate?.status).toBe('archived')
    expect(lastUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})
