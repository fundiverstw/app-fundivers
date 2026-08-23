import { supabase } from './supabase'
import { netPaid } from './payments'
import { depositCovered } from './booking-balance'
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
/**
 * Is the deposit satisfied at this paid level?
 *
 * `owed` is the amended balance when the caller has it. Falling back to the
 * frozen `details.total` is blind to amendments: a booking discounted below
 * its deposit would never promote however much the diver paid, and a
 * surcharged one would promote too early. When neither is known we cannot
 * clamp at all — an absent total tells us nothing about the balance, and
 * treating that as "owes nothing" would promote on any payment.
 */
function depositIsMet(
  details: BookingDetails, owed: number | undefined, deposit: number, paid: number,
): boolean {
  const rawTotal = (details as { total?: number }).total
  const effectiveOwed = owed ?? (rawTotal == null ? null : Number(rawTotal))
  return effectiveOwed == null ? paid >= deposit : depositCovered(deposit, effectiveOwed, paid)
}

export async function recordPayment(args: {
  booking: Pick<Booking, 'id' | 'user_id' | 'status' | 'details'>
  existingPayments: Payment[]
  amount: number
  note: string
  /** Receipt number, bank transfer reference or online payment transaction
   *  id. Required: `payments_reference_required` (20260823100000) rejects a
   *  money-moving row without one, so the check here is only to fail with a
   *  sentence an admin can act on instead of a constraint name. */
  reference: string
  recordedBy: string
  /** What the diver owes — details.total PLUS the amendment ledger. Callers
   *  that have the amendments should pass it; without it this falls back to
   *  the raw frozen total, which is blind to discounts and surcharges. */
  owed?: number
}): Promise<{ payment: Payment; newStatus: Booking['status'] }> {
  const { booking, existingPayments, amount, note, recordedBy } = args
  const reference = args.reference.trim()
  if (!reference) throw new Error('a payment reference is required')
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
      reference,
      recorded_by: recordedBy,
    })
    .select('*')
    .single()
  if (error || !payment) throw error ?? new Error('payment insert returned no row')

  const deposit = Number(details.deposit ?? 0)
  const prevPaid = netPaid(existingPayments)
  const newPaid = prevPaid + Number(payment.amount)
  // Clamped to what is owed: after a discount the frozen deposit can exceed
  // the balance, and a diver paying the discounted total in full would then
  // never cross it — their booking would sit pending forever.
  //
  // Only when we actually know the total. A booking whose details carry no
  // total tells us nothing about the balance, and treating that as "owes
  // nothing" would promote it on any payment at all.
  const shouldPromote = booking.status === 'pending' && depositIsMet(details, args.owed, deposit, newPaid)

  let newStatus: Booking['status'] = booking.status
  if (shouldPromote) {
    const { error: bErr } = await supabase.from('bookings').update({ status: 'confirmed' }).eq('id', booking.id)
    if (!bErr) newStatus = 'confirmed'
  }

  return { payment: payment as Payment, newStatus }
}

/**
 * Record a single lump payment from a lead booker against the whole group
 * they're paying for. Runs inside the record_group_payment SECURITY DEFINER
 * RPC (20260622000000): it distributes the amount across the lead's active
 * bookings (optionally narrowed to one group_id) — deposits first so spots
 * confirm, then balances, oldest first — inserting one paid payment row per
 * touched booking and auto-confirming pending siblings whose deposit is now
 * covered. Admin-only. Returns the amount actually applied (clamped to the
 * group's outstanding balances). Callers should refetch afterwards.
 */
export async function recordGroupPayment(args: {
  leadId: string
  amount: number
  /** As for `recordPayment` -- the RPC writes one real-money row per sibling
   *  booking and refuses a blank reference. */
  reference: string
  groupId?: string | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('record_group_payment', {
    p_lead: args.leadId,
    p_amount: args.amount,
    p_reference: args.reference.trim(),
    p_group_id: args.groupId ?? null,
  })
  if (error) throw error
  return Number(data ?? 0)
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
  /** Amended balance, as for recordPayment. */
  owed?: number
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
  // Recompute paid sum from the existing list, dropping the voided row.
  const newPaid = netPaid(existingPayments.filter(p => p.id !== paymentId))
  // Mirrors the promotion rule, so recording and voiding cannot disagree: a
  // booking discounted below its deposit was demoted by voiding any trivial
  // payment, even with the full amended balance still covered.
  const shouldRevert = booking.status === 'confirmed' && deposit > 0
    && !depositIsMet(details, args.owed, deposit, newPaid)

  let newStatus: Booking['status'] = booking.status
  if (shouldRevert) {
    const { error: bErr } = await supabase.from('bookings').update({ status: 'pending' }).eq('id', booking.id)
    if (!bErr) newStatus = 'pending'
  }

  return { payment: payment as Payment, newStatus }
}
