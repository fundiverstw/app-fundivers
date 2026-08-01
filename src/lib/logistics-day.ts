import { supabase } from './supabase'
import { fetchEventsInRange } from './events'
import type { Booking, Profile } from '../types/database'

/** A day's booking with the diver behind it — what the gear views read. */
export interface DayGearRow {
  booking: Booking
  profile: Profile | null
}

/**
 * One day's roster cut down to what the gear diff needs — who is booked and
 * what sizes they wear. Deliberately not the Logistics page's full day loader:
 * payments, staff, cars and add-ons change nothing about what's on the rack.
 *
 * The profile is what carries the sizes, so a diver whose row comes back
 * without one shows up as "no size on file" everywhere downstream. Both reads
 * therefore THROW on error rather than falling back to `[]`: a swallowed
 * profiles error renders as a confident, plausible, wrong answer — every sized
 * item unsized — which is worse than saying the read failed. Covered by an
 * integration test against the live stack for the same reason.
 */
export async function fetchDayGearRows(dayKey: string): Promise<DayGearRow[]> {
  const events = await fetchEventsInRange(dayKey, dayKey, { includePrivate: true })
  const eventIds = [...new Set(events.map(e => e.id))]
  if (!eventIds.length) return []
  const { data: bookingData, error: bookingError } = await supabase
    .from('bookings').select('*').in('event_id', eventIds).neq('status', 'cancelled')
  if (bookingError) throw new Error(`bookings for ${dayKey}: ${bookingError.message}`)
  const bookings = (bookingData ?? []) as Booking[]
  if (!bookings.length) return []
  const userIds = [...new Set(bookings.map(b => b.user_id))]
  const { data: profileData, error: profileError } = await supabase
    .from('profiles').select('*').in('id', userIds)
  if (profileError) throw new Error(`profiles for ${dayKey}: ${profileError.message}`)
  const profileMap = new Map(((profileData ?? []) as Profile[]).map(p => [p.id, p]))
  return bookings.map(b => ({ booking: b, profile: profileMap.get(b.user_id) ?? null }))
}
