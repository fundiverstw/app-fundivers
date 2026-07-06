import { supabase } from './supabase'
import { fetchAmendmentsForBookings, amendmentsDelta } from './booking-amendments'
import { siteConfig } from '../config/site'
import type { AppEvent, Credit, CreditInsert } from '../types/database'

/**
 * "Credits" are money the business owes a diver — typically issued when
 * an event is cancelled (weather, low signups). They sit at status='open'
 * until an admin settles them, either by paying the diver back externally
 * or by manually recording a payment when the diver applies the credit
 * to a new booking. We intentionally do NOT auto-create a paid payment
 * row on settle — the corresponding payment is recorded as a separate
 * action so the two-sided audit trail stays explicit.
 */

export async function fetchCreditsForUser(userId: string): Promise<Credit[]> {
  const { data, error } = await supabase
    .from('credits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Credit[]
}

export function openCreditBalance(credits: Credit[]): number {
  return credits.filter(c => c.status === 'open').reduce((s, c) => s + Number(c.amount), 0)
}

/** Sum of *open* credits tied to a specific booking — the live credit that
 *  offsets what the diver owes for that one event. Settled credits are already
 *  resolved (refunded or applied elsewhere) and never count here. */
export function openCreditForBooking(credits: Credit[], bookingId: string): number {
  return credits
    .filter(c => c.status === 'open' && c.booking_id === bookingId)
    .reduce((s, c) => s + Number(c.amount), 0)
}

/**
 * Total money the shop owes a diver — their "account credit". Two sources:
 *  1. Open awarded credits not tied to one of `bookings` (general credits,
 *     incl. cancellation credits whose booking is excluded as cancelled).
 *  2. Per active booking, any amount the diver is net ahead — an overpayment
 *     (paid more than owed) OR an awarded credit beyond what's owed. An
 *     overpayment is money owed back, so it counts as credit.
 * `bookings` should be the diver's NON-cancelled bookings with their adjusted
 * `owed` (total + amendments) and `paid` sums.
 *
 * `coveredBookingIds` are bookings a lead booker pays for on this diver's
 * behalf (payer_id set to someone else). The money on those bookings —
 * including any overpayment recorded under this diver's user_id by a group
 * payment — belongs to the lead, not this diver, so they're dropped from
 * both the per-booking and general terms.
 */
export function diverCreditBalance(
  credits: Credit[],
  bookings: Array<{ id: string; owed: number; paid: number }>,
  coveredBookingIds?: Set<string>,
): number {
  const owned = coveredBookingIds
    ? bookings.filter(b => !coveredBookingIds.has(b.id))
    : bookings
  const bookingIds = new Set(owned.map(b => b.id))
  const general = credits
    .filter(c => c.status === 'open' && (!c.booking_id || !bookingIds.has(c.booking_id)))
    .reduce((s, c) => s + Number(c.amount), 0)
  const perBooking = owned.reduce(
    (s, b) => s + Math.max(0, b.paid + openCreditForBooking(credits, b.id) - b.owed),
    0,
  )
  return general + perBooking
}

/** Load everything needed to compute a diver's account credit (credits +
 *  bookings + payments + amendments) and return the net figure. Used by the
 *  diver's own profile, which doesn't otherwise load booking/payment data. */
export async function fetchDiverCreditBalance(userId: string): Promise<number> {
  const [bookingsRes, paymentsRes, credits] = await Promise.all([
    supabase.from('bookings').select('id, details, status, payer_id').eq('user_id', userId),
    supabase.from('payments').select('booking_id, amount, status').eq('user_id', userId),
    fetchCreditsForUser(userId),
  ])
  const bookings = (bookingsRes.data ?? []).filter(b => b.status !== 'cancelled')
  const amendments = await fetchAmendmentsForBookings(bookings.map(b => b.id))
  const paidByBooking = new Map<string, number>()
  for (const p of (paymentsRes.data ?? [])) {
    if (!p.booking_id || p.status !== 'paid') continue
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + Number(p.amount))
  }
  // Bookings a lead booker pays for on this diver's behalf: exclude their
  // money from the diver's own account credit.
  const covered = new Set(
    bookings.filter(b => b.payer_id && b.payer_id !== userId).map(b => b.id),
  )
  const rows = bookings.map(b => ({
    id: b.id,
    owed: Number((b.details as { total?: number } | null)?.total ?? 0) + amendmentsDelta(amendments.get(b.id) ?? []),
    paid: paidByBooking.get(b.id) ?? 0,
  }))
  return diverCreditBalance(credits, rows, covered)
}

export async function createCredit(input: {
  user_id: string
  amount: number
  reason: string
  booking_id?: string | null
  currency?: string
  created_by: string
}): Promise<Credit> {
  const row: CreditInsert = {
    user_id:    input.user_id,
    booking_id: input.booking_id ?? null,
    amount:     input.amount,
    currency:   input.currency ?? siteConfig.locale.currency,
    reason:     input.reason,
    created_by: input.created_by,
    status:     'open',
  }
  const { data, error } = await supabase
    .from('credits')
    .insert(row)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('credit insert returned no row')
  return data as Credit
}

export async function settleCredit(args: {
  creditId: string
  note: string
}): Promise<Credit> {
  const { data, error } = await supabase
    .from('credits')
    .update({
      status:       'settled',
      settled_at:   new Date().toISOString(),
      settled_note: args.note,
    })
    .eq('id', args.creditId)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('credit update returned no row')
  return data as Credit
}

/**
 * Auto-issue an open credit to every non-cancelled registrant of an event
 * the admin just cancelled, each worth what that diver has actually paid
 * (Σ payments where status='paid'). The credit's reason names the specific
 * event so the diver and admin both see why it appeared.
 *
 * Idempotent per booking: a booking that already carries any credit is
 * skipped, so cancel → restore → cancel never double-issues (restoring an
 * event intentionally leaves issued credits untouched). Bookings with
 * nothing paid get no credit.
 */
export async function issueCancellationCredits(args: {
  event: AppEvent
  createdBy: string
}): Promise<{ issued: number; totalAmount: number }> {
  const { event, createdBy } = args

  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, user_id')
    .eq('event_id', event.id)
    .neq('status', 'cancelled')
  if (bErr) throw bErr
  if (!bookings?.length) return { issued: 0, totalAmount: 0 }

  const bookingIds = bookings.map(b => b.id)

  const { data: payments, error: pErr } = await supabase
    .from('payments')
    .select('booking_id, amount')
    .in('booking_id', bookingIds)
    .eq('status', 'paid')
  if (pErr) throw pErr

  const paidByBooking = new Map<string, number>()
  for (const p of payments ?? []) {
    if (!p.booking_id) continue
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + Number(p.amount))
  }

  const { data: existing, error: eErr } = await supabase
    .from('credits')
    .select('booking_id')
    .in('booking_id', bookingIds)
  if (eErr) throw eErr
  const alreadyCredited = new Set((existing ?? []).map(c => c.booking_id))

  // Format in the shop's timezone so the date in the reason matches the event's
  // calendar day regardless of where this runs — start_time is a UTC instant,
  // and a naive local format shifts the day in other runtimes.
  const eventDate = new Date(event.start_time).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: siteConfig.locale.timezone,
  })
  const reason = `Refund credit for cancelled event: ${event.title} (${eventDate})`

  const rows: CreditInsert[] = bookings
    .filter(b => !alreadyCredited.has(b.id) && (paidByBooking.get(b.id) ?? 0) > 0)
    .map(b => ({
      user_id:    b.user_id,
      booking_id: b.id,
      amount:     paidByBooking.get(b.id)!,
      reason,
      created_by: createdBy,
      status:     'open',
    }))

  if (!rows.length) return { issued: 0, totalAmount: 0 }

  const { error: iErr } = await supabase.from('credits').insert(rows)
  if (iErr) throw iErr

  return { issued: rows.length, totalAmount: rows.reduce((s, r) => s + r.amount, 0) }
}

/**
 * Spend a diver's open account credit toward a booking's unpaid balance.
 * Runs entirely inside the apply_credit_to_booking SECURITY DEFINER RPC
 * (20260620000000): it consumes open credit rows oldest-first, carries any
 * unspent remainder forward as a fresh credit, records an offsetting
 * 'account_credit' payment, and auto-confirms a pending booking once the
 * deposit is covered. The RPC clamps the request to what's owed and what's
 * available, so the returned figure is the amount actually applied (0 when
 * there's nothing to do). Callers should refetch afterwards.
 */
export async function applyCreditToBooking(args: {
  bookingId: string
  amount: number
}): Promise<number> {
  const { data, error } = await supabase.rpc('apply_credit_to_booking', {
    p_booking_id: args.bookingId,
    p_amount: args.amount,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function reopenCredit(creditId: string): Promise<Credit> {
  const { data, error } = await supabase
    .from('credits')
    .update({ status: 'open', settled_at: null, settled_note: null })
    .eq('id', creditId)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('credit update returned no row')
  return data as Credit
}
