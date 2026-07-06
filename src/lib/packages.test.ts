// packages lib: the express-interest RPC wrapper and the two diver-facing
// definer-function fetchers. The RPC/function contracts themselves are locked
// by the integration tests; here we only verify the wrapper shapes (rpc args,
// error propagation, empty-data coercion).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

beforeEach(() => { from.mockReset(); rpc.mockReset() })

describe('expressPackageInterest', () => {
  it('calls express_package_interest with the package id and returns the code', async () => {
    rpc.mockResolvedValue({ data: 'FD-7K2MQ4', error: null })
    const { expressPackageInterest } = await import('./packages')

    expect(await expressPackageInterest('pkg-1')).toBe('FD-7K2MQ4')
    expect(rpc).toHaveBeenCalledWith('express_package_interest', { p_package_id: 'pkg-1' })
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'package is not open for interest' } })
    const { expressPackageInterest } = await import('./packages')
    await expect(expressPackageInterest('pkg-1')).rejects.toBeTruthy()
  })

  it('throws when the RPC returns no code', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { expressPackageInterest } = await import('./packages')
    await expect(expressPackageInterest('pkg-1')).rejects.toThrow(/no code/i)
  })
})

describe('fetchPackageBoard', () => {
  it('calls list_package_board and returns rows', async () => {
    const rows = [{ id: 'p1', title: 'Raja Ampat', partner_name: 'Blue Manta' }]
    rpc.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchPackageBoard } = await import('./packages')

    expect(await fetchPackageBoard()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('list_package_board')
  })

  it('coerces a null payload to an empty list', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchPackageBoard } = await import('./packages')
    expect(await fetchPackageBoard()).toEqual([])
  })

  it('throws when the rpc errors', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null, error: { message: 'boom' } }))
    const { fetchPackageBoard } = await import('./packages')
    await expect(fetchPackageBoard()).rejects.toBeTruthy()
  })
})

describe('fetchPackageBoardItem', () => {
  it('returns the single board item', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: { id: 'p1', title: 'Raja Ampat' } }))
    const { fetchPackageBoardItem } = await import('./packages')
    expect(await fetchPackageBoardItem('p1')).toEqual({ id: 'p1', title: 'Raja Ampat' })
    expect(rpc).toHaveBeenCalledWith('list_package_board')
  })

  it('returns null when the package is not on the board', async () => {
    rpc.mockReturnValue(mockQueryBuilder({ data: null }))
    const { fetchPackageBoardItem } = await import('./packages')
    expect(await fetchPackageBoardItem('missing')).toBeNull()
  })
})

describe('fetchMyPackageReferrals', () => {
  it('calls list_my_package_referrals and returns rows', async () => {
    const rows = [{ id: 'r1', referral_code: 'FD-7K2MQ4', status: 'interested' }]
    rpc.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchMyPackageReferrals } = await import('./packages')

    expect(await fetchMyPackageReferrals()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('list_my_package_referrals')
  })
})
