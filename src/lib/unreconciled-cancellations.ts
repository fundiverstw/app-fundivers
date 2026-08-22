import { supabase } from './supabase'
import { netPaidByBooking } from './payments'
import { RETURN_SOURCES } from './credits'
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
//
// Both are one-way and mutually exclusive: doing neither hides the money,
// doing both pays the diver twice. Each action makes the row drop off the
// list, so an empty list means every cancellation is accounted for.

export interface UnreconciledCancellation {
  bookingId: string
  userId: string
  diverName: string
  eventId: string | null
  eventTitle: string
  /** Net paid still sitting on the booking (paid − refunded). Always > 0. */
  amount: number
  currency: string
}

type ProfileLite = { id: string; name: string | null; nickname: string | null }

/**
 * Pure selector: which cancelled bookings still hold money?
 *
 * A booking qualifies when it is cancelled, its net paid is positive, and no
 * credit tied to it says the money was already returned. Credits with any
 * other source (a goodwill award, a carry-forward remainder) are unrelated
 * money and deliberately do NOT clear the row — the same rule the automatic
 * issuers use, so this list and they can never disagree.
 */
export function selectUnreconciled(input: {
  bookings: Array<Pick<Booking, 'id' | 'user_id' | 'event_id' | 'status'>>
  payments: Array<Pick<Payment, 'booking_id' | 'amount' | 'status'>>
  credits: Array<Pick<Credit, 'booking_id' | 'source'>>
  events: Map<string, AppEvent>
  profiles: ProfileLite[]
  eventFallback: string
  diverFallback: string
}): UnreconciledCancellation[] {
  const paidByBooking = netPaidByBooking(input.payments)
  const returned = new Set(
    input.credits
      .filter(c => c.booking_id && (RETURN_SOURCES as readonly string[]).includes(c.source))
      .map(c => c.booking_id as string),
  )
  const nameById = new Map(input.profiles.map(p => [p.id, personName(p.name, p.nickname)]))

  return input.bookings
    .filter(b => b.status === 'cancelled' && !returned.has(b.id) && (paidByBooking.get(b.id) ?? 0) > 0)
    .map(b => ({
      bookingId: b.id,
      userId: b.user_id,
      diverName: nameById.get(b.user_id) || input.diverFallback,
      eventId: b.event_id,
      eventTitle: (b.event_id ? input.events.get(b.event_id)?.title : null) ?? input.eventFallback,
      amount: paidByBooking.get(b.id)!,
      currency: siteConfig.locale.currency,
    }))
    .sort((a, b) => b.amount - a.amount)
}

export async function fetchUnreconciledCancellations(labels: {
  eventFallback: string
  diverFallback: string
}): Promise<UnreconciledCancellation[]> {
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, user_id, event_id, status')
    .eq('status', 'cancelled')
  if (error) throw error
  if (!bookings?.length) return []

  const bookingIds = bookings.map(b => b.id)
  const userIds = [...new Set(bookings.map(b => b.user_id).filter((x): x is string => !!x))]
  const eventIds = [...new Set(bookings.map(b => b.event_id).filter((x): x is string => !!x))]

  const [paymentsRes, creditsRes, profilesRes, events] = await Promise.all([
    supabase.from('payments').select('booking_id, amount, status').in('booking_id', bookingIds),
    supabase.from('credits').select('booking_id, source').in('booking_id', bookingIds),
    supabase.from('profiles').select('id, name, nickname').in('id', userIds),
    fetchEventsForBookings(eventIds),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (creditsRes.error) throw creditsRes.error
  if (profilesRes.error) throw profilesRes.error

  return selectUnreconciled({
    bookings,
    payments: paymentsRes.data ?? [],
    credits: (creditsRes.data ?? []) as Array<Pick<Credit, 'booking_id' | 'source'>>,
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
}): Promise<void> {
  const { error } = await supabase.from('payments').insert({
    user_id:     args.row.userId,
    booking_id:  args.row.bookingId,
    amount:      args.row.amount,
    currency:    args.row.currency,
    status:      'refunded',
    note:        args.note,
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
