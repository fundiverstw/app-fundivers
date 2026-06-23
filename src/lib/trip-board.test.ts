// trip-board lib: the express-interest RPC wrapper and the two diver-facing
// view fetchers. The RPC/view contracts themselves are locked by the
// integration tests; here we only verify the wrapper shapes (rpc args,
// error propagation, empty-data coercion).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

beforeEach(() => { from.mockReset(); rpc.mockReset() })

describe('expressTripInterest', () => {
  it('calls express_trip_interest with the trip id and returns the code', async () => {
    rpc.mockResolvedValue({ data: 'FD-7K2MQ4', error: null })
    const { expressTripInterest } = await import('./trip-board')

    expect(await expressTripInterest('trip-1')).toBe('FD-7K2MQ4')
    expect(rpc).toHaveBeenCalledWith('express_trip_interest', { p_trip_id: 'trip-1' })
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'trip is not open for interest' } })
    const { expressTripInterest } = await import('./trip-board')
    await expect(expressTripInterest('trip-1')).rejects.toBeTruthy()
  })

  it('throws when the RPC returns no code', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { expressTripInterest } = await import('./trip-board')
    await expect(expressTripInterest('trip-1')).rejects.toThrow(/no code/i)
  })
})

describe('fetchTripBoard', () => {
  it('reads the trip_board view and returns rows', async () => {
    const rows = [{ id: 't1', title: 'Raja Ampat', partner_name: 'Blue Manta' }]
    from.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchTripBoard } = await import('./trip-board')

    expect(await fetchTripBoard()).toEqual(rows)
    expect(from).toHaveBeenCalledWith('trip_board')
  })

  it('coerces a null payload to an empty list', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchTripBoard } = await import('./trip-board')
    expect(await fetchTripBoard()).toEqual([])
  })

  it('throws when the view read errors', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'boom' } }))
    const { fetchTripBoard } = await import('./trip-board')
    await expect(fetchTripBoard()).rejects.toBeTruthy()
  })
})

describe('fetchTripBoardItem', () => {
  it('returns the single board item', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: { id: 't1', title: 'Raja Ampat' } }))
    const { fetchTripBoardItem } = await import('./trip-board')
    expect(await fetchTripBoardItem('t1')).toEqual({ id: 't1', title: 'Raja Ampat' })
    expect(from).toHaveBeenCalledWith('trip_board')
  })

  it('returns null when the trip is not on the board', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchTripBoardItem } = await import('./trip-board')
    expect(await fetchTripBoardItem('missing')).toBeNull()
  })
})

describe('fetchMyTripReferrals', () => {
  it('reads the my_trip_referrals view and returns rows', async () => {
    const rows = [{ id: 'r1', referral_code: 'FD-7K2MQ4', status: 'interested' }]
    from.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchMyTripReferrals } = await import('./trip-board')

    expect(await fetchMyTripReferrals()).toEqual(rows)
    expect(from).toHaveBeenCalledWith('my_trip_referrals')
  })
})
