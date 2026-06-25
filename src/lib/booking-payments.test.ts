// voidPayment has two interesting branches:
//   - if the remaining paid sum drops below the booking's deposit AND
//     the booking is currently confirmed, flip it back to pending
//     (symmetric inverse of recordPayment's promote)
//   - otherwise leave the booking status alone
//
// Both paths share the "set payments.status = voided" effect.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Booking, Payment } from '../types/database'

// Hoisted spies for the chained supabase mock.
const { from, rpc, paymentsUpdate, bookingsUpdate } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  paymentsUpdate: vi.fn(),
  bookingsUpdate: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
  paymentsUpdate.mockReset()
  bookingsUpdate.mockReset()
})

function setupSupabase(updatedPayment: Payment) {
  // payments: .update(...).eq(...).select('*').single() resolves to the
  // updated row. bookings: .update(...).eq(...) resolves to { error: null }.
  paymentsUpdate.mockReturnValue({
    eq: () => ({
      select: () => ({
        single: () => Promise.resolve({ data: updatedPayment, error: null }),
      }),
    }),
  })
  bookingsUpdate.mockReturnValue({
    eq: () => Promise.resolve({ error: null }),
  })
  from.mockImplementation((table: string) => {
    if (table === 'payments') return { update: paymentsUpdate }
    if (table === 'bookings') return { update: bookingsUpdate }
    throw new Error(`unexpected table: ${table}`)
  })
}

const basePaid: Payment = {
  id: 'p1', created_at: '2026-05-20T00:00:00Z',
  user_id: 'u1', booking_id: 'b1',
  amount: 5000, currency: 'TWD',
  status: 'paid', method: 'bank_transfer',
  note: 'Deposit', recorded_by: 'admin',
}

describe('voidPayment', () => {
  it('voids the payment and reverts the booking to pending when the remaining paid sum falls below the deposit', async () => {
    setupSupabase({ ...basePaid, status: 'voided' })
    const { voidPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'status' | 'details'> = {
      id: 'b1',
      status: 'confirmed',
      details: { deposit: 5000, total: 10000, payment_method: 'bank_transfer' },
    }
    const { payment, newStatus } = await voidPayment({
      booking,
      existingPayments: [basePaid],
      paymentId: 'p1',
    })

    expect(payment.status).toBe('voided')
    expect(paymentsUpdate).toHaveBeenCalledWith({ status: 'voided' })
    expect(newStatus).toBe('pending')
    expect(bookingsUpdate).toHaveBeenCalledWith({ status: 'pending' })
  })

  it('leaves the booking alone when other paid payments still cover the deposit', async () => {
    setupSupabase({ ...basePaid, status: 'voided' })
    const { voidPayment } = await import('./booking-payments')

    const other: Payment = { ...basePaid, id: 'p2', amount: 5000 }
    const booking: Pick<Booking, 'id' | 'status' | 'details'> = {
      id: 'b1',
      status: 'confirmed',
      details: { deposit: 5000, total: 10000, payment_method: 'bank_transfer' },
    }
    const { newStatus } = await voidPayment({
      booking,
      existingPayments: [basePaid, other],
      paymentId: 'p1',
    })

    expect(newStatus).toBe('confirmed')
    // No bookings update issued because the auto-revert branch didn't fire.
    expect(bookingsUpdate).not.toHaveBeenCalled()
  })

  it('does not touch booking status when the booking is already pending', async () => {
    setupSupabase({ ...basePaid, status: 'voided' })
    const { voidPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'status' | 'details'> = {
      id: 'b1',
      status: 'pending',
      details: { deposit: 5000, total: 10000, payment_method: 'bank_transfer' },
    }
    const { newStatus } = await voidPayment({
      booking,
      existingPayments: [basePaid],
      paymentId: 'p1',
    })

    expect(newStatus).toBe('pending')
    expect(bookingsUpdate).not.toHaveBeenCalled()
  })

  it('refuses to void a payment that is not currently `paid`', async () => {
    setupSupabase({ ...basePaid, status: 'voided' })
    const { voidPayment } = await import('./booking-payments')

    const refunded: Payment = { ...basePaid, status: 'refunded' }
    await expect(
      voidPayment({
        booking: { id: 'b1', status: 'confirmed', details: { deposit: 5000 } },
        existingPayments: [refunded],
        paymentId: 'p1',
      })
    ).rejects.toThrow(/only paid payments can be voided/i)
  })

  it('errors when the payment id is not in the provided list', async () => {
    setupSupabase({ ...basePaid, status: 'voided' })
    const { voidPayment } = await import('./booking-payments')

    await expect(
      voidPayment({
        booking: { id: 'b1', status: 'confirmed', details: { deposit: 5000 } },
        existingPayments: [],
        paymentId: 'p1',
      })
    ).rejects.toThrow(/not found/i)
  })
})

describe('recordPayment', () => {
  function setupForRecord(
    inserted: Payment | null,
    opts: { insertError?: unknown; bookingError?: unknown } = {},
  ) {
    const insert = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({ data: inserted, error: opts.insertError ?? null }),
      }),
    }))
    bookingsUpdate.mockReturnValue({ eq: () => Promise.resolve({ error: opts.bookingError ?? null }) })
    from.mockImplementation((table: string) => {
      if (table === 'payments') return { insert }
      if (table === 'bookings') return { update: bookingsUpdate }
      throw new Error(`unexpected table: ${table}`)
    })
    return { insert }
  }

  it('promotes a pending booking to confirmed once the paid sum reaches the deposit', async () => {
    setupForRecord({ ...basePaid, id: 'p-new', amount: 5000 })
    const { recordPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending',
      details: { deposit: 5000, total: 10000, payment_method: 'bank_transfer' },
    }
    const { newStatus } = await recordPayment({
      booking, existingPayments: [], amount: 5000, note: 'Deposit', recordedBy: 'admin',
    })
    expect(newStatus).toBe('confirmed')
    expect(bookingsUpdate).toHaveBeenCalledWith({ status: 'confirmed' })
  })

  it('accumulates prior paid payments — a partial top-up that crosses the deposit confirms', async () => {
    setupForRecord({ ...basePaid, id: 'p-new', amount: 2000 })
    const { recordPayment } = await import('./booking-payments')

    const prior: Payment = { ...basePaid, id: 'p0', amount: 3000 }
    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending',
      details: { deposit: 5000, payment_method: 'bank_transfer' },
    }
    const { newStatus } = await recordPayment({
      booking, existingPayments: [prior], amount: 2000, note: 'Balance', recordedBy: 'admin',
    })
    expect(newStatus).toBe('confirmed')
  })

  it('leaves a pending booking pending when the paid sum is still below the deposit', async () => {
    setupForRecord({ ...basePaid, id: 'p-new', amount: 2000 })
    const { recordPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending',
      details: { deposit: 5000, payment_method: 'bank_transfer' },
    }
    const { newStatus } = await recordPayment({
      booking, existingPayments: [], amount: 2000, note: 'Partial', recordedBy: 'admin',
    })
    expect(newStatus).toBe('pending')
    expect(bookingsUpdate).not.toHaveBeenCalled()
  })

  it('counts only paid existing payments toward the deposit — voided rows do not promote', async () => {
    setupForRecord({ ...basePaid, id: 'p-new', amount: 2000 })
    const { recordPayment } = await import('./booking-payments')

    const voided: Payment = { ...basePaid, id: 'pv', amount: 9999, status: 'voided' }
    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending',
      details: { deposit: 5000, payment_method: 'bank_transfer' },
    }
    const { newStatus } = await recordPayment({
      booking, existingPayments: [voided], amount: 2000, note: 'Partial', recordedBy: 'admin',
    })
    expect(newStatus).toBe('pending')
    expect(bookingsUpdate).not.toHaveBeenCalled()
  })

  it('auto-confirms a zero-deposit event on the first payment', async () => {
    setupForRecord({ ...basePaid, id: 'p-new', amount: 1000 })
    const { recordPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending',
      details: { deposit: 0, payment_method: 'cash' },
    }
    const { newStatus } = await recordPayment({
      booking, existingPayments: [], amount: 1000, note: 'Full', recordedBy: 'admin',
    })
    expect(newStatus).toBe('confirmed')
  })

  it('never re-promotes an already-confirmed booking (no bookings update)', async () => {
    setupForRecord({ ...basePaid, id: 'p-new', amount: 5000 })
    const { recordPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'confirmed',
      details: { deposit: 5000, payment_method: 'bank_transfer' },
    }
    const { newStatus } = await recordPayment({
      booking, existingPayments: [], amount: 5000, note: 'Extra', recordedBy: 'admin',
    })
    expect(newStatus).toBe('confirmed')
    expect(bookingsUpdate).not.toHaveBeenCalled()
  })

  it('inserts a paid row carrying the booking method, ids, note and recorder', async () => {
    const { insert } = setupForRecord({ ...basePaid, id: 'p-new', amount: 2000 })
    const { recordPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending',
      details: { deposit: 5000, payment_method: 'bank_transfer' },
    }
    await recordPayment({ booking, existingPayments: [], amount: 2000, note: 'Partial', recordedBy: 'admin-9' })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u1', booking_id: 'b1', amount: 2000, status: 'paid',
      method: 'bank_transfer', note: 'Partial', recorded_by: 'admin-9',
    })
  })

  it('records method null when the booking details carry no payment_method', async () => {
    const { insert } = setupForRecord({ ...basePaid, id: 'p-new', amount: 2000 })
    const { recordPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending', details: { deposit: 5000 },
    }
    await recordPayment({ booking, existingPayments: [], amount: 2000, note: 'Partial', recordedBy: 'admin' })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ method: null }))
  })

  it('throws when the payment insert returns no row', async () => {
    setupForRecord(null, { insertError: { message: 'insert failed' } })
    const { recordPayment } = await import('./booking-payments')

    await expect(recordPayment({
      booking: { id: 'b1', user_id: 'u1', status: 'pending', details: { deposit: 5000 } },
      existingPayments: [], amount: 2000, note: 'x', recordedBy: 'admin',
    })).rejects.toBeTruthy()
  })

  it('leaves status unchanged when the promotion booking update fails', async () => {
    setupForRecord({ ...basePaid, id: 'p-new', amount: 5000 }, { bookingError: { message: 'update failed' } })
    const { recordPayment } = await import('./booking-payments')

    const booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'> = {
      id: 'b1', user_id: 'u1', status: 'pending',
      details: { deposit: 5000, payment_method: 'bank_transfer' },
    }
    const { payment, newStatus } = await recordPayment({
      booking, existingPayments: [], amount: 5000, note: 'Deposit', recordedBy: 'admin',
    })
    expect(newStatus).toBe('pending')
    expect(payment.id).toBe('p-new')
  })
})

describe('recordGroupPayment', () => {
  it('calls the record_group_payment RPC and returns the applied amount', async () => {
    rpc.mockResolvedValue({ data: 6000, error: null })
    const { recordGroupPayment } = await import('./booking-payments')

    const applied = await recordGroupPayment({ leadId: 'lead-1', amount: 6000, groupId: 'g1' })
    expect(applied).toBe(6000)
    expect(rpc).toHaveBeenCalledWith('record_group_payment', {
      p_lead: 'lead-1', p_amount: 6000, p_group_id: 'g1',
    })
  })

  it('defaults p_group_id to null when no group is given, and coerces a null result to 0', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { recordGroupPayment } = await import('./booking-payments')

    expect(await recordGroupPayment({ leadId: 'lead-1', amount: 1000 })).toBe(0)
    expect(rpc).toHaveBeenCalledWith('record_group_payment', {
      p_lead: 'lead-1', p_amount: 1000, p_group_id: null,
    })
  })

  it('throws when the RPC returns an error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'admin only' } })
    const { recordGroupPayment } = await import('./booking-payments')
    await expect(recordGroupPayment({ leadId: 'lead-1', amount: 1000 })).rejects.toBeTruthy()
  })
})
