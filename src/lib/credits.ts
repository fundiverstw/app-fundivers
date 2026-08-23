import { supabase } from './supabase'
import { fetchAmendmentsForBookings, amendmentsDelta } from './booking-amendments'
import { netPaidByBooking } from './payments'
import { siteConfig } from '../config/site'
import type { AppEvent, Credit, CreditInsert } from '../types/database'

/**
 * The diver's account ledger: a signed list of everything owed between them
 * and the shop that is not attached to a booking.
 *
 * POSITIVE rows are credits — money the business owes a diver, typically
 * issued when an event is cancelled (weather, low signups). NEGATIVE rows are
 * charges (`source = 'admin_charge'`) — money the diver owes the shop for
 * something with no event behind it, a mask off the rack or a lost fin.
 *
 * Rows sit at status='open' until something closes them. Closing is automatic:
 * `apply_credit_to_booking` settles credits as it spends them, and the
 * restore-reclaim trigger settles what it takes back. There is deliberately no
 * manual settle — an admin correcting a balance issues the opposite row, which
 * leaves both halves visible in the statement instead of making one disappear
 * behind a note.
 *
 * Because the amount is signed, every `sum(amount) where status = 'open'` in
 * this file nets charges against credits for free. What is NOT free is the
 * clamping: "how much can this diver spend" can never be negative, so the two
 * spendable figures floor at zero while the statement's balance stays signed.
 */

/** The two credit sources that mean "this booking's money is given back RIGHT
 *  NOW". Only these suppress a further automatic refund; a goodwill credit, a
 *  carry-forward row, or a refund already reclaimed by restoring the booking
 *  (`return_reclaimed`) is not money currently owed back. Kept in step with the
 *  credits_source_check constraint (20260822100000, widened in 20260822120000
 *  and again in 20260823130000)
 *  and with the same list inside bookings_return_account_credit_on_cancel. */
export const RETURN_SOURCES = ['event_cancellation', 'booking_cancellation_return'] as const

export async function fetchCreditsForUser(userId: string): Promise<Credit[]> {
  const { data, error } = await supabase
    .from('credits')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Credit[]
}

/** Spendable account credit from the ledger alone: open credits less open
 *  charges, floored at zero. A diver who owes the shop more than they hold has
 *  nothing to spend, not a negative amount to spend. */
export function openCreditBalance(credits: Credit[]): number {
  const net = credits.filter(c => c.status === 'open').reduce((s, c) => s + Number(c.amount), 0)
  return Math.max(0, net)
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
  // Floored for the same reason each booking's term is: this answers "how much
  // can they spend". Account charges make `general` able to go negative, and a
  // diver who owes the shop 500 can spend nothing, not minus 500. The signed
  // position is `buildDiverStatement`'s balance, which deliberately does not
  // clamp.
  return Math.max(0, general + perBooking)
}

/**
 * How much credit a one-tap "apply to my balances" would ACTUALLY spend.
 *
 * The button used to promise `min(openCreditBalance, totalOwed)`, which
 * overstates twice over: the sweep only touches the diver's own solo bookings
 * (not the groups they lead, which `totalOwed` includes), and
 * `openCreditBalance` counts credit tied to a booking the RPC refuses to
 * re-spend on itself. A diver holding a 3000 credit awarded against the very
 * booking they owe 2000 on was offered "Use 2000" and got nothing back.
 *
 * This replays what `apply_credit_to_booking` will do, target by target, in
 * the order the sweep visits them: for each, the spendable pool is every open
 * row NOT tied to that booking, the take is clamped to what is still due, and
 * rows drain oldest-first so a later target sees the pool the earlier ones
 * left behind. `due` must already net the booking's own tied credit, exactly
 * as the RPC's `v_due` does.
 *
 * Returns the total that will be applied — 0 when the button should not show.
 */
export function plannedCreditApplication(
  credits: Credit[],
  targets: ReadonlyArray<{ id: string; due: number }>,
): number {
  const pool = credits
    .filter(c => c.status === 'open')
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map(c => ({ bookingId: c.booking_id, amount: Number(c.amount) }))

  let applied = 0
  for (const target of targets) {
    if (target.due <= 0) continue
    // Availability nets account charges, exactly as the RPC's v_avail does…
    const available = pool.reduce((s, c) => c.bookingId === target.id ? s : s + c.amount, 0)
    let take = Math.min(target.due, Math.max(0, available))
    if (take <= 0) continue
    applied += take
    for (const row of pool) {
      if (take <= 0) break
      if (row.bookingId === target.id) continue
      // …but only credits are drained. Draining a charge would settle a debt
      // and hand the money back, since `min(negative, take)` is negative.
      if (row.amount <= 0) continue
      const used = Math.min(row.amount, take)
      row.amount -= used
      take -= used
    }
  }
  return applied
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
  const paidByBooking = netPaidByBooking(paymentsRes.data ?? [])
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
    source:     'manual',
  }
  const { data, error } = await supabase
    .from('credits')
    .insert(row)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('credit insert returned no row')
  return data as Credit
}

/**
 * Charge a diver for something with no event behind it — goods off the shelf,
 * a lost weight belt, a tank fill. Stored as a negative row on the same
 * ledger, so it nets against their credit everywhere at once.
 *
 * Never tied to a booking: `credits_charge_untied` refuses that, because a
 * charge against a specific trip is a `booking_amendments` surcharge, and one
 * living here would be double-counted by `openCreditForBooking`.
 *
 * `amount` is passed POSITIVE — the caller says how much to charge, and the
 * sign is this function's business.
 */
export async function createAccountCharge(input: {
  user_id: string
  amount: number
  reason: string
  currency?: string
  created_by: string
}): Promise<Credit> {
  if (!(input.amount > 0)) throw new Error('a charge amount must be positive')
  if (input.reason.trim().length < 3) throw new Error('a charge needs a reason')
  const row: CreditInsert = {
    user_id:    input.user_id,
    booking_id: null,
    amount:     -Math.abs(input.amount),
    currency:   input.currency ?? siteConfig.locale.currency,
    reason:     input.reason.trim(),
    created_by: input.created_by,
    status:     'open',
    source:     'admin_charge',
  }
  const { data, error } = await supabase
    .from('credits')
    .insert(row)
    .select('*')
    .single()
  if (error || !data) throw error ?? new Error('charge insert returned no row')
  return data as Credit
}

/**
 * Auto-issue an open credit to every non-cancelled registrant of an event
 * the admin just cancelled, each worth what that diver has actually paid net
 * of any prior refund (paid − refunded). The credit's reason names the specific
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
    .select('booking_id, amount, status')
    .in('booking_id', bookingIds)
    .in('status', ['paid', 'refunded'])
  if (pErr) throw pErr

  const paidByBooking = netPaidByBooking(payments ?? [])

  // Only a credit that already RETURNED this booking's money blocks a second
  // issue. The old check was "does this booking carry ANY credit row?", which
  // let an unrelated goodwill credit of 200 suppress the whole refund of a
  // 3000 booking. See credits.source (20260822100000).
  const { data: existing, error: eErr } = await supabase
    .from('credits')
    .select('booking_id')
    .in('booking_id', bookingIds)
    .in('source', RETURN_SOURCES)
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
      currency:   siteConfig.locale.currency,
      reason,
      created_by: createdBy,
      status:     'open',
      source:     'event_cancellation',
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
