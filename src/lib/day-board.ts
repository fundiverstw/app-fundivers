import { supabase } from './supabase'
import { fetchEventsInRange } from './events'
import { bookingsOnDay } from './course-continuation'
import { fetchAmendmentsForBookings } from './booking-amendments'
import { fetchVehiclesForEvents } from './event-vehicles'
import { fetchRideGroups } from './ride-groups'
import type {
  AppEvent, Booking, BookingAmendment, BookingDetails, Credit, Duty,
  EventRideGroup, EventVehicle, Payment, Profile,
} from '../types/database'

/** The add-on catalog columns the board reads — enough to name a rental and
 *  pick the delicate ones out for the care inventory. */
export interface AddonTitleRow {
  id: string
  display_title: string | null
  admin_title: string | null
}

/**
 * Every row one day's logistics board is built from, in the shape the page
 * derives its groups, balances and totals from.
 *
 * This exists as a lib rather than an effect body so the same call can be
 * replayed ten times over to fill the offline snapshot. The offline path
 * returns this identical structure, so the board cannot render one shape online
 * and a subtly different one on a boat.
 */
export interface DayBoardData {
  events: AppEvent[]
  bookings: Booking[]
  duties: Duty[]
  addons: AddonTitleRow[]
  profiles: Profile[]
  payments: Payment[]
  credits: Credit[]
  /** Flat, oldest-first. Regroup with `amendmentsByBooking` — a Map does not
   *  survive the structured clone into IndexedDB as anything the board can use
   *  without knowing to rebuild it, so the wire shape is the array. */
  amendments: BookingAmendment[]
}

/** Car allocations and ride groupings for a day. Split from DayBoardData
 *  because the page refetches these on their own after an assign/unassign,
 *  while the roster behind them has not moved. */
export interface DayTransportData {
  allocations: EventVehicle[]
  rideGroups: EventRideGroup[]
}

export const EMPTY_DAY_BOARD: DayBoardData = {
  events: [], bookings: [], duties: [], addons: [],
  profiles: [], payments: [], credits: [], amendments: [],
}

/** Rebuild the per-booking ledger the balance math wants. */
export function amendmentsByBooking(rows: BookingAmendment[]): Map<string, BookingAmendment[]> {
  const map = new Map<string, BookingAmendment[]>()
  for (const row of rows) {
    const arr = map.get(row.booking_id) ?? []
    arr.push(row)
    map.set(row.booking_id, arr)
  }
  return map
}

/**
 * One day's board, read live. Events first, then everything hanging off them.
 *
 * Errors are NOT swallowed into empty arrays. A board that renders "nobody is
 * booked" because the bookings read failed is a confident wrong answer, and the
 * caller needs to be able to tell that apart from a genuinely quiet day before
 * it decides whether to fall back to the on-device snapshot.
 */
export async function fetchDayBoard(day: string): Promise<DayBoardData> {
  // fetchEventsInRange(day, day) returns dives starting that day and courses
  // running that day. A rare multi-day dive that started earlier won't appear —
  // acceptable for a day-of view.
  const events = await fetchEventsInRange(day, day, { includePrivate: true })
  // Dedupe by id (a course can yield more than one segment); first wins.
  const seen = new Set<string>()
  const uniqueEvents = events.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  if (!uniqueEvents.length) return { ...EMPTY_DAY_BOARD }

  const eventIds = uniqueEvents.map(e => e.id)
  // Duties whose date range covers this day. A null end_date is a single-day duty.
  const dayCovered = `end_date.gte.${day},end_date.is.null`
  const [bookingsRes, dutiesRes] = await Promise.all([
    supabase.from('bookings').select('*').in('event_id', eventIds).neq('status', 'cancelled'),
    supabase.from('duties').select('*').in('event_id', eventIds).lte('start_date', day).or(dayCovered),
  ])
  if (bookingsRes.error) throw new Error(`bookings for ${day}: ${bookingsRes.error.message}`)
  if (dutiesRes.error) throw new Error(`duties for ${day}: ${dutiesRes.error.message}`)

  // Drop the bookings that aren't on site today: a course booking may be
  // limited to some of its course's days when the diver is finishing a course
  // they started on an earlier one. Everything downstream — headcount, gear,
  // cars, balances — is a day-of view, so this belongs at the source.
  const bookings = bookingsOnDay((bookingsRes.data ?? []) as Booking[], day)
  const duties = (dutiesRes.data ?? []) as Duty[]

  const addonIds = [...new Set(
    bookings.flatMap(b => (b.details as BookingDetails | undefined)?.add_ons ?? []),
  )]
  const userIds = [...new Set([
    ...bookings.map(b => b.user_id),
    // Lead payers may not themselves be booked that day, but the board still
    // needs their name for "paid by …" on a covered diver's balance.
    ...bookings.map(b => b.payer_id).filter((x): x is string => !!x),
    ...duties.map(d => d.assignee_id),
  ])]
  const bookingIds = bookings.map(b => b.id)

  const [addonsRes, profilesRes, paymentsRes, creditsRes, amendmentMap] = await Promise.all([
    addonIds.length
      ? supabase.from('addons').select('id, display_title, admin_title').in('id', addonIds)
      : Promise.resolve({ data: [] as AddonTitleRow[], error: null }),
    userIds.length
      ? supabase.from('profiles').select('*').in('id', userIds)
      : Promise.resolve({ data: [] as Profile[], error: null }),
    bookingIds.length
      ? supabase.from('payments').select('*').in('booking_id', bookingIds)
      : Promise.resolve({ data: [] as Payment[], error: null }),
    userIds.length
      ? supabase.from('credits').select('*').in('user_id', userIds).eq('status', 'open')
      : Promise.resolve({ data: [] as Credit[], error: null }),
    fetchAmendmentsForBookings(bookingIds),
  ])
  // The profiles read carries every diver's sizes. Swallowing its failure
  // renders as "no size on file" for the whole day — plausible, confident and
  // wrong — so it throws like the rest.
  if (profilesRes.error) throw new Error(`profiles for ${day}: ${profilesRes.error.message}`)
  if (paymentsRes.error) throw new Error(`payments for ${day}: ${paymentsRes.error.message}`)
  if (creditsRes.error) throw new Error(`credits for ${day}: ${creditsRes.error.message}`)
  if (addonsRes.error) throw new Error(`addons for ${day}: ${addonsRes.error.message}`)

  return {
    events: uniqueEvents,
    bookings,
    duties,
    addons: (addonsRes.data ?? []) as AddonTitleRow[],
    profiles: (profilesRes.data ?? []) as Profile[],
    payments: (paymentsRes.data ?? []) as Payment[],
    credits: (creditsRes.data ?? []) as Credit[],
    amendments: [...amendmentMap.values()].flat(),
  }
}

/** Cars and ride groupings for a day's events. */
export async function fetchDayTransport(day: string, eventIds: string[]): Promise<DayTransportData> {
  if (!eventIds.length) return { allocations: [], rideGroups: [] }
  const [allocations, rideGroups] = await Promise.all([
    fetchVehiclesForEvents(eventIds),
    fetchRideGroups(day, eventIds),
  ])
  return { allocations, rideGroups }
}
