// package-admin lib: the publish-stamp rule is the only non-trivial logic
// (insert/update routing is mechanical). We assert that going live stamps
// published_at exactly once and never clobbers an existing stamp.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Package } from '../types/database'

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

const basePackage: Package = {
  id: 'p1', created_at: '2026-06-01T00:00:00Z', trusted_partner_id: 's1',
  title: 'Raja Ampat', destination: 'Indonesia', summary: null, description: null,
  start_date: null, end_date: null, price: 60000, currency: 'TWD',
  hero_image_url: null, highlights: [], booking_url: null, kickback_rate: 0.05,
  status: 'draft', published_at: null, created_by: null,
}

describe('savePackage publish stamp', () => {
  it('stamps published_at when a new package is created already published', async () => {
    const { savePackage } = await import('./package-admin')
    await savePackage({ trusted_partner_id: 's1', title: 'X', destination: 'Y', status: 'published' })
    expect(lastInsert?.published_at).toBeTruthy()
  })

  it('does not stamp a draft package', async () => {
    const { savePackage } = await import('./package-admin')
    await savePackage({ trusted_partner_id: 's1', title: 'X', destination: 'Y', status: 'draft' })
    expect(lastInsert?.published_at).toBeFalsy()
  })

  it('stamps on first publish of an existing draft', async () => {
    const { savePackage } = await import('./package-admin')
    await savePackage({ ...basePackage, status: 'published' }, basePackage)
    expect(lastUpdate?.published_at).toBeTruthy()
  })

  it('preserves the original stamp when re-saving an already-published package', async () => {
    const { savePackage } = await import('./package-admin')
    const live: Package = { ...basePackage, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await savePackage({ ...live, title: 'Renamed' }, live)
    expect(lastUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})

describe('setPackageStatus', () => {
  it('stamps published_at the first time a draft is published', async () => {
    const { setPackageStatus } = await import('./package-admin')
    await setPackageStatus(basePackage, 'published')
    expect(lastUpdate?.status).toBe('published')
    expect(lastUpdate?.published_at).toBeTruthy()
  })

  it('keeps the stamp when archiving a published package', async () => {
    const { setPackageStatus } = await import('./package-admin')
    const live: Package = { ...basePackage, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await setPackageStatus(live, 'archived')
    expect(lastUpdate?.status).toBe('archived')
    expect(lastUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})
