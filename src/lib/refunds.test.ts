import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rejectRefundRequest } from './refunds'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn(), auth: { getSession: vi.fn() } },
}))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
beforeEach(() => { from.mockReset() })

function updateBuilder(error: unknown = null) {
  const calls: { update?: unknown; eqCol?: string; eqVal?: unknown } = {}
  const b = {
    update: (patch: unknown) => { calls.update = patch; return b },
    eq: (col: string, val: unknown) => {
      calls.eqCol = col; calls.eqVal = val
      return Promise.resolve({ error })
    },
  }
  return { b, calls }
}

describe('rejectRefundRequest', () => {
  it('clears the request stamp on that booking, changing nothing else', async () => {
    // Rejecting must leave the booking exactly as it was before the diver
    // asked — in particular it must not touch `status`, which is what
    // APPROVING a refund does.
    const { b, calls } = updateBuilder()
    from.mockReturnValue(b)

    await rejectRefundRequest('b1')

    expect(from).toHaveBeenCalledWith('bookings')
    expect(calls.update).toEqual({ refund_requested_at: null })
    expect(calls.eqCol).toBe('id')
    expect(calls.eqVal).toBe('b1')
  })

  it('surfaces a supabase error rather than reporting success', async () => {
    const { b } = updateBuilder({ message: 'denied by RLS' })
    from.mockReturnValue(b)
    await expect(rejectRefundRequest('b1')).rejects.toBeTruthy()
  })
})
