import { supabase } from './supabase'
import { netPaidByBooking } from './payments'
import { cancellationKept } from './credits'
import { fetchEventsForBookings } from './events'
import { personName } from './names'
import { siteConfig } from '../config/site'
import type { AppEvent, Booking, Credit, Payment } from '../types/database'

// Money left sitting on a cancelled booking.
//
// Only ONE of the four cancellations returns money by itself: the shop calling
// off an event, which credits every registrant their net paid. The other three
// — a diver self-cancelling, an admin cancelling one booking, an approved
// refund request — cancel the booking and stop there, because bank transfer
// and cash moved off-app and only a person can move them back.
//
// Nothing surfaced the gap. `bookingBalance` short-circuits a cancelled
// booking to "settled", `diverCreditBalance` drops cancelled bookings from the
// active set, and the refund queue lists only NON-cancelled bookings. So a
// diver who paid 3000 and cancelled saw a settled balance and no credit, the
// admin saw nothing at all, and the shop still held the money. This module is
// the missing list, with the only two correct endings attached to it:
//
//   • the money went back  → record a `refunded` payment row
//   • the shop keeps it as store credit → issue an open credit
//   • the shop keeps the cash (a cancellation fee) → stamp the booking settled
//
// The first two work by recording a money movement. The third moves nothing —
// the money is already counted as revenue on that event — so it records an
// acknowledgment instead: without one, a kept fee is indistinguishable from
// money nobody has dealt with, and its row would sit here forever.
//
// The endings are mutually exclusive. Doing none hides the money; doing two
// pays the diver twice. Each makes the row drop off, so an empty list means
// every cancellation is accounted for.
//
// A booking can also be PART settled — a late canceller gets their account
// credit back and their cash does not, a policy withholds a non-refundable
// deposit and returns the rest. The list carries the remainder in that case,
// not the whole payment, so the amount an admin acts on is the amount still
// open.

export interface UnreconciledCancellation {
  bookingId: string
  userId: string
  diverName: string
  eventId: string | null
  eventTitle: string
  /** What is still unaccounted for: net paid less anything already handed
   *  back as a cancellation credit. Always > 0. Not the same as net paid —
   *  a policy that withholds a non-refundable deposit returns part of a
   *  booking and leaves the rest here. */
  amount: number
  currency: string
  /** Who cancelled it and when (`bookings.cancelled_at` / `cancelled_by`).
   *  Null on cancellations older than 20260823120000 that the admin audit log
   *  never witnessed. Shown on the holding list because the person who
   *  stranded the money is usually the person who can say what happened to
   *  it. */
  cancelledAt: string | null
  cancelledBy: string | null
}

type ProfileLite = { id: string; name: string | null }

/**
 * Pure selector: which cancelled bookings still hold money?
 *
 * A booking qualifies when it is cancelled, no admin has stamped it settled,
 * and money is still unaccounted for: net paid less whatever a cancellation
 * credit already handed back. Credits with any other source (a goodwill award,
 * a carry-forward remainder) are unrelated money and deliberately do NOT count
 * as returned — the same rule the automatic issuers use, so this list and they
 * can never disagree.
 *
 * The subtraction replaced a test for whether a return credit merely EXISTED.
 * That was right while a cancellation was all-or-nothing, and wrong the moment
 * one could be part-returned: a late canceller who paid 7,000 cash and 3,000
 * account credit gets the 3,000 back, and the row then vanished from this list
 * carrying 7,000 nobody had decided about — hidden by exactly the credit that
 * proved only part of it was settled.
 */
export function selectUnreconciled(input: {
  bookings: Array<Pick<Booking, 'id' | 'user_id' | 'event_id' | 'status' | 'cancellation_settled_at' | 'cancelled_at' | 'cancelled_by'>>
  payments: Array<Pick<Payment, 'booking_id' | 'amount' | 'status'>>
  credits: Array<Pick<Credit, 'booking_id' | 'source' | 'amount'>>
  events: Map<string, AppEvent>
  profiles: ProfileLite[]
  eventFallback: string
  diverFallback: string
}): UnreconciledCancellation[] {
  const paidByBooking = netPaidByBooking(input.payments)
  const outstanding = (id: string) =>
    cancellationKept(paidByBooking.get(id) ?? 0, input.credits, id)
  const nameById = new Map(input.profiles.map(p => [p.id, personName(p.name)]))

  return input.bookings
    .filter(b =>
      b.status === 'cancelled'
      && !b.cancellation_settled_at
      && outstanding(b.id) > 0)
    .map(b => ({
      bookingId: b.id,
      userId: b.user_id,
      diverName: nameById.get(b.user_id) || input.diverFallback,
      eventId: b.event_id,
      eventTitle: (b.event_id ? input.events.get(b.event_id)?.title : null) ?? input.eventFallback,
      amount: outstanding(b.id),
      currency: siteConfig.locale.currency,
      cancelledAt: b.cancelled_at,
      cancelledBy: b.cancelled_by,
    }))
    .sort((a, b) => b.amount - a.amount)
}

export async function fetchUnreconciledCancellations(labels: {
  eventFallback: string
  diverFallback: string
}): Promise<UnreconciledCancellation[]> {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, user_id, event_id, status, cancellation_settled_at, cancelled_at, cancelled_by')
    .eq('status', 'cancelled')
    .is('cancellation_settled_at', null)
  if (error) throw error
  if (!bookings?.length) return []

  const bookingIds = bookings.map(b => b.id)
  const userIds = [...new Set(bookings.map(b => b.user_id).filter((x): x is string => !!x))]
  const eventIds = [...new Set(bookings.map(b => b.event_id).filter((x): x is string => !!x))]

  const [paymentsRes, creditsRes, profilesRes, events] = await Promise.all([
    supabase.from('payments').select('booking_id, amount, status').in('booking_id', bookingIds),
    supabase.from('credits').select('booking_id, source, amount').in('booking_id', bookingIds),
    supabase.from('profiles').select('id, name').in('id', userIds),
    fetchEventsForBookings(eventIds),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (creditsRes.error) throw creditsRes.error
  if (profilesRes.error) throw profilesRes.error

  return selectUnreconciled({
    bookings,
    payments: paymentsRes.data ?? [],
    credits: (creditsRes.data ?? []) as Array<Pick<Credit, 'booking_id' | 'source' | 'amount'>>,
    events,
    profiles: profilesRes.data ?? [],
    ...labels,
  })
}

/** The money went back to the diver off-app. Records the matching `refunded`
 *  row so net paid falls to zero and the books reconcile. */
export async function recordCancellationRefund(args: {
  row: UnreconciledCancellation
  recordedBy: string
  note: string
  /** The transfer that sent the money back. A refund is the one movement a
   *  diver is most likely to query, so it is the last place to accept "trust
   *  me" -- `payments_reference_required` rejects the row without it. */
  reference: string
}): Promise<void> {
  const reference = args.reference.trim()
  if (!reference) throw new Error('a refund reference is required')
  const { error } = await supabase.from('payments').insert({
    user_id:     args.row.userId,
    booking_id:  args.row.bookingId,
    amount:      args.row.amount,
    currency:    args.row.currency,
    status:      'refunded',
    note:        args.note,
    reference,
    recorded_by: args.recordedBy,
  })
  if (error) throw error
}

/** The shop keeps the money as store credit. Stamped with the same source the
 *  automatic issuers use, so neither can later pay it out a second time. */
export async function convertCancellationToCredit(args: {
  row: UnreconciledCancellation
  createdBy: string
  reason: string
}): Promise<void> {
  const { error } = await supabase.from('credits').insert({
    user_id:    args.row.userId,
    booking_id: args.row.bookingId,
    amount:     args.row.amount,
    currency:   args.row.currency,
    reason:     args.reason,
    status:     'open',
    created_by: args.createdBy,
    source:     'booking_cancellation_return',
  })
  if (error) throw error
}

/**
 * The shop keeps the money — a cancellation fee, or a forfeited booking.
 *
 * Moves nothing: the cash is already recorded as a paid payment on that event,
 * so the books are right. What is missing is a record that someone *decided*
 * this, which is what takes the row off the list. The note captures the amount
 * so the Audits feed shows what was kept, not just that a flag flipped.
 */
export async function settleCancellationAsKept(args: {
  row: UnreconciledCancellation
  settledBy: string
  note: string
}): Promise<void> {
  const { error } = await supabase
    .from('bookings')
    .update({
      cancellation_settled_at:   new Date().toISOString(),
      cancellation_settled_by:   args.settledBy,
      cancellation_settled_note: args.note,
    } as never)
    .eq('id', args.row.bookingId)
  if (error) throw error
}
