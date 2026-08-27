import { supabase } from './supabase'
import { netPaidByBooking } from './payments'
import { RETURN_SOURCES } from './credits'
import { fetchEventsForBookings } from './events'
import { personName } from './names'
import { siteConfig } from '../config/site'
import type { Booking, Credit, Payment } from '../types/database'

// Bookings handed back more money than they ever took in.
//
// A refund credit is a claim about a specific booking: "what you paid for this
// is yours again". It cannot exceed what the booking received, and when it
// does, one of the two rows behind it is wrong — either the payment was voided
// when it should have stood, or the credit was issued when it should not have
// been. The database cannot tell which. A person can, given the list.
//
// Only the two RETURN_SOURCES count. A goodwill credit or a carry-forward
// remainder is not a claim about what was paid, so a diver who was awarded 500
// for a bad dive on a 200 booking is not over-refunded — they were given
// something. Counting every credit would flag every act of generosity the shop
// has ever performed and bury the real thing.
//
// Status is deliberately ignored. A settled credit is money already spent
// somewhere else, which is the opposite of harmless — it is the case where the
// shop can no longer simply withdraw the row.

export interface OverRefunded {
  bookingId: string
  userId: string
  diverName: string
  eventTitle: string
  /** Net of refunds, as every other surface counts it. */
  netPaid: number
  /** Everything handed back on this booking as a cancellation refund. */
  returned: number
  /** returned − netPaid. Always > 0. */
  excess: number
  currency: string
}

type ProfileLite = { id: string; name: string | null; nickname: string | null }

/** Pure selector: which bookings gave back more than they received? */
export function selectOverRefunded(input: {
  bookings: Array<Pick<Booking, 'id' | 'user_id' | 'event_id'>>
  payments: Array<Pick<Payment, 'booking_id' | 'amount' | 'status'>>
  credits: Array<Pick<Credit, 'booking_id' | 'source' | 'amount'>>
  eventTitles: Map<string, string>
  profiles: ProfileLite[]
  eventFallback: string
  diverFallback: string
}): OverRefunded[] {
  const paid = netPaidByBooking(input.payments)
  const returnedBy = new Map<string, number>()
  for (const c of input.credits) {
    if (!c.booking_id) continue
    if (!(RETURN_SOURCES as readonly string[]).includes(c.source)) continue
    returnedBy.set(c.booking_id, (returnedBy.get(c.booking_id) ?? 0) + Number(c.amount))
  }
  const nameById = new Map(input.profiles.map(p => [p.id, personName(p.name, p.nickname)]))

  return input.bookings
    .map(b => {
      const netPaid = paid.get(b.id) ?? 0
      const returned = returnedBy.get(b.id) ?? 0
      return {
        bookingId: b.id,
        userId: b.user_id,
        diverName: nameById.get(b.user_id) || input.diverFallback,
        eventTitle: (b.event_id ? input.eventTitles.get(b.event_id) : null) ?? input.eventFallback,
        netPaid,
        returned,
        excess: returned - netPaid,
        currency: siteConfig.locale.currency,
      }
    })
    .filter(r => r.excess > 0)
    .sort((a, b) => b.excess - a.excess)
}

export async function fetchOverRefunded(labels: {
  eventFallback: string
  diverFallback: string
}): Promise<OverRefunded[]> {
  // Only bookings that carry a refund credit can possibly be over-refunded, so
  // that is the set to start from rather than every booking the shop has ever
  // taken.
  const { data: creditRows, error: cErr } = await supabase
    .from('credits')
    .select('booking_id, source, amount')
    .in('source', RETURN_SOURCES)
    .not('booking_id', 'is', null)
  if (cErr) throw cErr
  const credits = (creditRows ?? []) as Array<Pick<Credit, 'booking_id' | 'source' | 'amount'>>
  const bookingIds = [...new Set(credits.map(c => c.booking_id).filter((id): id is string => !!id))]
  if (!bookingIds.length) return []

  const [bookingsRes, paymentsRes] = await Promise.all([
    supabase.from('bookings').select('id, user_id, event_id').in('id', bookingIds),
    supabase.from('payments').select('booking_id, amount, status').in('booking_id', bookingIds),
  ])
  if (bookingsRes.error) throw bookingsRes.error
  if (paymentsRes.error) throw paymentsRes.error
  const bookings = (bookingsRes.data ?? []) as Array<Pick<Booking, 'id' | 'user_id' | 'event_id'>>

  const userIds = [...new Set(bookings.map(b => b.user_id).filter((id): id is string => !!id))]
  const { data: profiles } = await supabase
    .from('profiles').select('id, name, nickname').in('id', userIds)

  const events = await fetchEventsForBookings(
    [...new Set(bookings.map(b => b.event_id).filter((id): id is string => !!id))],
  )
  const eventTitles = new Map([...events].map(([id, e]) => [id, e.title]))

  return selectOverRefunded({
    bookings,
    payments: (paymentsRes.data ?? []) as Array<Pick<Payment, 'booking_id' | 'amount' | 'status'>>,
    credits,
    eventTitles,
    profiles: (profiles ?? []) as ProfileLite[],
    eventFallback: labels.eventFallback,
    diverFallback: labels.diverFallback,
  })
}
