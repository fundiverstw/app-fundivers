import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchSiteMap, submitSiteMapContribution } from './site-map-store'
import type { DiveSite } from '../types/database'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

const site: DiveSite = {
  id: 's1', name: 'Bat Cave', name_zh_tw: null, name_ja: null, kind: 'dive',
  region: null, notes: null, active: true, verified: true,
  latitude: null, longitude: null, created_by: null,
} as DiveSite

/** A `.select().eq()` chain resolving to the given rows or error. */
function rows(data: unknown[], error: unknown = null) {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => Promise.resolve({ data, error })
  return b
}

/** The map-row chain: `.select().eq().maybeSingle()`. */
function single(data: unknown, error: unknown = null) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) }) }
}

beforeEach(() => { from.mockReset(); rpc.mockReset() })

describe('fetchSiteMap', () => {
  function mock(mapResult: ReturnType<typeof single> | ReturnType<typeof rows>) {
    from.mockImplementation((table: string) => {
      if (table === 'dive_site_maps') return mapResult
      return rows([])
    })
  }

  it('surfaces an error reading the map row, rather than treating it as unmapped', async () => {
    mock(single(null, new Error('permission denied')))
    await expect(fetchSiteMap(site)).rejects.toThrow('permission denied')
  })

  it('surfaces an error reading the soundings', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'dive_site_maps') return single(null)
      if (table === 'dive_site_soundings') return rows([], new Error('denied'))
      return rows([])
    })
    await expect(fetchSiteMap(site)).rejects.toThrow('denied')
  })

  it('returns an empty, usable map for a place nobody has measured', async () => {
    mock(single(null))
    const map = await fetchSiteMap(site)
    expect(map).toMatchObject({
      id: 's1', name: 'Bat Cave', soundings: [], features: [], entries: [], bearings: [],
    })
  })

  it('coerces PostgREST numeric strings back into numbers', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'dive_site_maps') return single({
        extent_m: '80', origin_lat: null, origin_lng: null,
        rotation_deg: '12.5', provenance: null, bearings: null,
      })
      if (table === 'dive_site_soundings') return rows([{
        id: 'a', x: '1', y: '2', depth_m: '5.5', datum: 'instantaneous',
        observed_at: null, source: 'diver', contribution_id: null,
        supersedes: null, uncertainty_m: null,
      }])
      return rows([])
    })
    const map = await fetchSiteMap(site)
    expect(map.extent_m).toBe(80)
    expect(map.frame.rotationDeg).toBe(12.5)
    expect(map.soundings[0]).toMatchObject({ at: { x: 1, y: 2 }, depth_m: 5.5 })
  })
})

describe('submitSiteMapContribution', () => {
  it('calls the RPC with the contribution and returns the id it filed on', async () => {
    rpc.mockResolvedValue({ data: 'contribution-1', error: null })
    const id = await submitSiteMapContribution({
      siteId: 's1',
      contribution: { site_id: 's1', soundings: [], features: [], entries: [] },
    })
    expect(id).toBe('contribution-1')
    expect(rpc).toHaveBeenCalledWith('submit_site_map_contribution', expect.objectContaining({
      p_site_id: 's1', p_soundings: [], p_features: [], p_entries: [], p_note: null,
    }))
  })

  it('throws rather than returning an id nothing was filed on', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('offline') })
    await expect(submitSiteMapContribution({
      siteId: 's1',
      contribution: { site_id: 's1', soundings: [], features: [], entries: [] },
    })).rejects.toThrow('offline')
  })
})
