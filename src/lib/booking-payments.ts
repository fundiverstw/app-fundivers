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
