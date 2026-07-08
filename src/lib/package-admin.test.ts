// package-admin lib: the publish-stamp rule and tier reconciliation are the
// non-trivial logic. We assert going live stamps published_at exactly once and
// never clobbers an existing stamp, and that savePackage diffs tier rows
// (delete removed, update kept, insert new).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Package } from '../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

// Capture what each table's writers received so we can assert on them.
let lastPackageInsert: Record<string, unknown> | null
let lastPackageUpdate: Record<string, unknown> | null
let tierInserts: Record<string, unknown>[]
let tierUpdates: Record<string, unknown>[]
let tierDeletes: unknown[]
let existingTierRows: Array<{ id: string }>

beforeEach(() => {
  from.mockReset()
  lastPackageInsert = null
  lastPackageUpdate = null
  tierInserts = []
  tierUpdates = []
  tierDeletes = []
  existingTierRows = []
  from.mockImplementation((table: string) => {
    if (table === 'package_tiers') {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: existingTierRows, error: null }) }),
        delete: () => ({ in: (_col: string, ids: unknown[]) => { tierDeletes.push(...ids); return Promise.resolve({ error: null }) } }),
        update: (p: Record<string, unknown>) => { tierUpdates.push(p); return { eq: () => Promise.resolve({ error: null }) } },
        insert: (p: Record<string, unknown>) => { tierInserts.push(p); return Promise.resolve({ error: null }) },
      }
    }
    // packages
    return {
      insert: (p: Record<string, unknown>) => {
        lastPackageInsert = p
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-pkg' }, error: null }) }) }
      },
      update: (p: Record<string, unknown>) => { lastPackageUpdate = p; return { eq: () => Promise.resolve({ error: null }) } },
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }
  })
})

const basePackage: Package = {
  id: 'p1', created_at: '2026-06-01T00:00:00Z', trusted_partner_id: 's1',
  title: 'Raja Ampat', destination: 'Indonesia', summary: null, description: null,
  currency: 'TWD', hero_image_url: null, highlights: [], addon_ids: [], room_type_ids: [],
  kickback_rate: 0.05, status: 'draft', published_at: null, created_by: null,
}
const oneTier = [{ name: 'A', price: 1000 }]

describe('savePackage publish stamp', () => {
  it('stamps published_at when a new package is created already published', async () => {
    const { savePackage } = await import('./package-admin')
    await savePackage({ trusted_partner_id: 's1', title: 'X', destination: 'Y', status: 'published' }, oneTier)
    expect(lastPackageInsert?.published_at).toBeTruthy()
  })

  it('does not stamp a draft package', async () => {
    const { savePackage } = await import('./package-admin')
    await savePackage({ trusted_partner_id: 's1', title: 'X', destination: 'Y', status: 'draft' }, oneTier)
    expect(lastPackageInsert?.published_at).toBeFalsy()
  })

  it('preserves the original stamp when re-saving an already-published package', async () => {
    const { savePackage } = await import('./package-admin')
    const live: Package = { ...basePackage, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await savePackage({ ...live, title: 'Renamed' }, oneTier, live)
    expect(lastPackageUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})

describe('savePackage tier reconciliation', () => {
  it('inserts tiers for a new package with sort_order following draft order', async () => {
    const { savePackage } = await import('./package-admin')
    await savePackage(
      { trusted_partner_id: 's1', title: 'X', destination: 'Y', status: 'draft', currency: 'TWD' },
      [{ name: 'A', price: 1000 }, { name: 'B', price: 2000 }],
    )
    expect(tierInserts).toEqual([
      { package_id: 'new-pkg', name: 'A', price: 1000, currency: 'TWD', sort_order: 0 },
      { package_id: 'new-pkg', name: 'B', price: 2000, currency: 'TWD', sort_order: 1 },
    ])
  })

  it('updates kept tiers, inserts new ones, and deletes removed ones', async () => {
    existingTierRows = [{ id: 'keep' }, { id: 'gone' }]
    const { savePackage } = await import('./package-admin')
    await savePackage(
      { ...basePackage },
      [{ id: 'keep', name: 'A', price: 1500 }, { name: 'C', price: 3000 }],
      basePackage,
    )
    expect(tierDeletes).toEqual(['gone'])
    expect(tierUpdates).toEqual([{ package_id: 'p1', name: 'A', price: 1500, currency: 'TWD', sort_order: 0 }])
    expect(tierInserts).toEqual([{ package_id: 'p1', name: 'C', price: 3000, currency: 'TWD', sort_order: 1 }])
  })
})

describe('setPackageStatus', () => {
  it('stamps published_at the first time a draft is published', async () => {
    const { setPackageStatus } = await import('./package-admin')
    await setPackageStatus(basePackage, 'published')
    expect(lastPackageUpdate?.status).toBe('published')
    expect(lastPackageUpdate?.published_at).toBeTruthy()
  })

  it('keeps the stamp when archiving a published package', async () => {
    const { setPackageStatus } = await import('./package-admin')
    const live: Package = { ...basePackage, status: 'published', published_at: '2026-05-01T00:00:00Z' }
    await setPackageStatus(live, 'archived')
    expect(lastPackageUpdate?.status).toBe('archived')
    expect(lastPackageUpdate?.published_at).toBe('2026-05-01T00:00:00Z')
  })
})
