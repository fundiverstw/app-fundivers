import { supabase } from './supabase'
import type { Booking, BookingDetails, Payment } from '../types/database'

/**
 * Record a paid payment row against a booking and, if the cumulative paid
 * sum has crossed the booking's deposit threshold, promote a pending booking
 * to confirmed. Returns the inserted payment row and the booking's status
 * after any promotion so callers can update local state without refetching.
 *
 * Shared by AdminEventDetailPage and AdminUsersPage so the rules
 * ("deposit fully paid → auto-confirm pending") stay in one place.
 */
export async function recordPayment(args: {
  booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'>
  existingPayments: Payment[]
  amount: number
  note: string
  recordedBy: string
}): Promise<{ payment: Payment; newStatus: Booking['status'] }> {
  const { booking, existingPayments, amount, note, recordedBy } = args
  const details = (booking.details ?? {}) as BookingDetails
  const method = details.payment_method ?? null

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      user_id:     booking.user_id,
      booking_id:  booking.id,
      amount,
      status:      'paid',
      method,
      note,
      recorded_by: recordedBy,
    })
    .select('*')
    .single()
  if (error || !payment) throw error ?? new Error('payment insert returned no row')

  const deposit = Number(details.deposit ?? 0)
  const prevPaid = existingPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const newPaid = prevPaid + Number(payment.amount)
  const shouldPromote = booking.status === 'pending' && newPaid >= deposit

  let newStatus: Booking['status'] = booking.status
  if (shouldPromote) {
    const { error: bErr } = await supabase.from('bookings').update({ status: 'confirmed' }).eq('id', booking.id)
    if (!bErr) newStatus = 'confirmed'
  }

  return { payment: payment as Payment, newStatus }
}

/**
 * Revert a payment that was incorrectly marked as paid. Sets status to
 * 'voided' (kept in the table for audit — every paid-sum aggregator
 * filters by status='paid' so voided rows drop out). Symmetrically with
 * recordPayment, if voiding pulls the paid sum below the booking's
 * deposit threshold AND the booking is currently 'confirmed', the
 * booking flips back to 'pending'. Bookings the admin manually moved
 * to 'confirmed' for reasons unrelated to payments are *not* reverted
 * — only the auto-promotion path is undone.
 */
export async function voidPayment(args: {
  booking: Pick<Booking, 'id' | 'status' | 'details'>
  existingPayments: Payment[]
  paymentId: string
}): Promise<{ payment: Payment; newStatus: Booking['status'] }> {
  const { booking, existingPayments, paymentId } = args
  const target = existingPayments.find(p => p.id === paymentId)
  if (!target) throw new Error('payment not found in existing list')
  if (target.status !== 'paid') throw new Error(`only paid payments can be voided (this one is ${target.status})`)

  const { data: payment, error } = await supabase
    .from('payments')
    .update({ status: 'voided' })
    .eq('id', paymentId)
    .select('*')
    .single()
  if (error || !payment) throw error ?? new Error('payment update returned no row')

  const details = (booking.details ?? {}) as BookingDetails
  const deposit = Number(details.deposit ?? 0)
  // Recompute paid sum from the existing list, swapping in the voided row.
  const newPaid = existingPayments.reduce((s, p) => {
    if (p.id === paymentId) return s
    return p.status === 'paid' ? s + Number(p.amount) : s
  }, 0)
  const shouldRevert = booking.status === 'confirmed' && deposit > 0 && newPaid < deposit

  let newStatus: Booking['status'] = booking.status
  if (shouldRevert) {
    const { error: bErr } = await supabase.from('bookings').update({ status: 'pending' }).eq('id', booking.id)
    if (!bErr) newStatus = 'pending'
  }

  return { payment: payment as Payment, newStatus }
}
