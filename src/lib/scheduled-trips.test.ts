import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

beforeEach(() => { rpc.mockReset() })

describe('fetchScheduledTrips', () => {
  it('calls list_scheduled_trips and returns rows', async () => {
    const rows = [{ id: 's1', title: 'Palau Liveaboard', event_id: 'e1', event_kind: 'dive' }]
    rpc.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchScheduledTrips } = await import('./scheduled-trips')

    expect(await fetchScheduledTrips()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('list_scheduled_trips')
  })

  it('coerces a null payload to an empty list', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchScheduledTrips } = await import('./scheduled-trips')
    expect(await fetchScheduledTrips()).toEqual([])
  })

  it('throws when the rpc errors', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'boom' } }))
    const { fetchScheduledTrips } = await import('./scheduled-trips')
    await expect(fetchScheduledTrips()).rejects.toBeTruthy()
  })
})
