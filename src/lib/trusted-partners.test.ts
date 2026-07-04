import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  fetchTrustedPartners, contactTrustedPartner,
  fetchAllTrustedPartners, saveTrustedPartner, deleteTrustedPartner,
} from './trusted-partners'

const { rpc, from, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), invoke: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

beforeEach(() => { rpc.mockReset(); from.mockReset(); invoke.mockReset() })

describe('trusted-partners lib', () => {
  it('fetchTrustedPartners reads the public projection via the RPC (no direct table access)', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'p1', name: 'Blue Manta', region: 'Anilao', blurb: null }], error: null })
    const res = await fetchTrustedPartners()
    expect(rpc).toHaveBeenCalledWith('list_trusted_partners')
    expect(from).not.toHaveBeenCalled()
    expect(res).toEqual([{ id: 'p1', name: 'Blue Manta', region: 'Anilao', blurb: null }])
  })

  it('contactTrustedPartner invokes the edge function with partner_id + message', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })
    await contactTrustedPartner({ partnerId: 'p1', message: 'hi' })
    expect(invoke).toHaveBeenCalledWith('contact-trusted-partner', { body: { partner_id: 'p1', message: 'hi' } })
  })

  it('contactTrustedPartner surfaces the edge function error body', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { message: 'edge', context: { json: async () => ({ error: 'partner not found' }) } },
    })
    await expect(contactTrustedPartner({ partnerId: 'p1', message: 'hi' })).rejects.toThrow(/partner not found/)
  })

  it('admin fetch/save/delete go through the trusted_partners table', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [], error: null }))
    await fetchAllTrustedPartners()
    await saveTrustedPartner({ name: 'X', email: 'x@y.io' } as never)
    await saveTrustedPartner({ name: 'Y', email: 'y@y.io' } as never, 'p9')
    await deleteTrustedPartner('p9')
    expect(from).toHaveBeenCalledTimes(4)
    expect(from).toHaveBeenCalledWith('trusted_partners')
  })
})
