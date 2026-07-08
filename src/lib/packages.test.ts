// packages lib: the register-package edge-fn wrapper, the diver-facing
// definer-function fetchers, and the diver-owned cancel RPC. The RPC/function
// contracts themselves are locked by the integration tests; here we only verify
// the wrapper shapes (invoke/rpc args, error propagation, empty-data coercion).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

beforeEach(() => { rpc.mockReset(); invoke.mockReset() })

describe('registerForPackage', () => {
  const input = {
    packageId: 'pkg-1', tierId: 't1', preferredStart: '2026-08-01', preferredEnd: '2026-08-05',
    addonIds: ['a1', 'a2'], roomId: 'r1', notes: 'window seat',
  }

  it('invokes register-package with the snake_cased body and returns the result', async () => {
    invoke.mockResolvedValue({ data: { registration_id: 'reg-1', estimated_cost: 12000, estimated_currency: 'TWD' }, error: null })
    const { registerForPackage } = await import('./packages')

    const res = await registerForPackage(input)
    expect(res).toEqual({ registration_id: 'reg-1', estimated_cost: 12000, estimated_currency: 'TWD' })
    expect(invoke).toHaveBeenCalledWith('register-package', {
      body: {
        package_id: 'pkg-1', tier_id: 't1', preferred_start: '2026-08-01', preferred_end: '2026-08-05',
        addon_ids: ['a1', 'a2'], room_id: 'r1', notes: 'window seat',
      },
    })
  })

  it('throws when the edge function errors', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'package is not open for registration' } })
    const { registerForPackage } = await import('./packages')
    await expect(registerForPackage(input)).rejects.toBeTruthy()
  })

  it('surfaces the server error body from the FunctionsHttpError context', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'tier not found for this package' }) } },
    })
    const { registerForPackage } = await import('./packages')
    await expect(registerForPackage(input)).rejects.toThrow(/tier not found for this package/)
  })
})

describe('fetchPackageBoard', () => {
  it('calls list_package_board and returns rows', async () => {
    const rows = [{ id: 'p1', title: 'Raja Ampat', partner_name: 'Blue Manta', min_price: 60000 }]
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

describe('fetchPackageTiers', () => {
  it('calls list_package_tiers with the package id', async () => {
    const rows = [{ id: 't1', name: 'A', price: 1000, currency: 'TWD' }]
    rpc.mockResolvedValue({ data: rows, error: null })
    const { fetchPackageTiers } = await import('./packages')
    expect(await fetchPackageTiers('pkg-1')).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('list_package_tiers', { p_package_id: 'pkg-1' })
  })
})

describe('fetchMyPackageRegistrations', () => {
  it('calls list_my_package_registrations and returns rows', async () => {
    const rows = [{ id: 'reg1', package_id: 'p1', status: 'registered', estimated_cost: 5000 }]
    rpc.mockReturnValue(mockQueryBuilder({ data: rows }))
    const { fetchMyPackageRegistrations } = await import('./packages')

    expect(await fetchMyPackageRegistrations()).toEqual(rows)
    expect(rpc).toHaveBeenCalledWith('list_my_package_registrations')
  })
})

describe('cancelMyPackageRegistration', () => {
  it('calls the definer RPC with the registration id', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { cancelMyPackageRegistration } = await import('./packages')
    await cancelMyPackageRegistration('reg-1')
    expect(rpc).toHaveBeenCalledWith('cancel_my_package_registration', { p_id: 'reg-1' })
  })

  it('throws when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { cancelMyPackageRegistration } = await import('./packages')
    await expect(cancelMyPackageRegistration('reg-1')).rejects.toBeTruthy()
  })
})
