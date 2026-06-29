import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import { setBookingTransportation } from './booking-transport'
import { supabase } from './supabase'
import type { BookingDetails } from '../types/database'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
beforeEach(() => from.mockReset())

describe('setBookingTransportation', () => {
  it('writes transportation onto details, preserving the rest, without touching charges/total', async () => {
    const builder = mockQueryBuilder({ error: null })
    const update = vi.fn(() => builder)
    builder.update = update
    from.mockReturnValue(builder)

    const current: BookingDetails = {
      transportation: false,
      total: 3200,
      charges: [{ kind: 'base', label: 'Base', amount: 3200 }],
      payment_method: 'cash',
    }
    const next = await setBookingTransportation('b1', current, true)

    expect(update).toHaveBeenCalledWith({
      details: expect.objectContaining({ transportation: true, total: 3200, payment_method: 'cash' }),
    })
    // Frozen pricing is carried through untouched.
    expect(next.total).toBe(3200)
    expect(next.charges).toEqual(current.charges)
    expect(next.transportation).toBe(true)
  })

  it('handles null current details', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: null }))
    const next = await setBookingTransportation('b1', null, true)
    expect(next).toEqual({ transportation: true })
  })

  it('surfaces a supabase error', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: { message: 'boom' } }))
    await expect(setBookingTransportation('b1', {}, false)).rejects.toBeTruthy()
  })
})
