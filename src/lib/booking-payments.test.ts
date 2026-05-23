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
const { from, paymentsUpdate, bookingsUpdate } = vi.hoisted(() => ({
  from: vi.fn(),
  paymentsUpdate: vi.fn(),
  bookingsUpdate: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
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
