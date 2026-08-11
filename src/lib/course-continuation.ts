import { format } from 'date-fns'
import { supabase } from './supabase'
import { parseIsoDate } from './dates'
import { t } from '../i18n'
import type { Booking } from '../types/database'

// A course finished across two or more scheduled courses (20260814000000).
//
// The student's money lives on the booking they made first; the continuation
// booking exists so they appear on the second course's roster, gear list and
// headcount for the days they're actually there. Everything here is about
// reading that pair correctly — the writing is one RPC call, because the rules
// that make the pairing valid belong in the database.

/** A date column or `course_days` entry as a 'YYYY-MM-DD' key. */
export function dayKeyOf(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim()
  return s ? s.slice(0, 10) : null
}

/** A course day as the admin reads it: 'Jul 4'. */
export function dayLabel(dayKey: string): string {
  return format(parseIsoDate(dayKey), 'MMM d')
}

export function isCourseContinuation(b: Pick<Booking, 'continues_booking_id'>): boolean {
  return !!b.continues_booking_id
}

/**
 * Days this booking is present for, as date keys. Empty means "not limited" —
 * `attend_days` is NULL on every normal booking and on everything written
 * before the column existed, and that has to keep meaning "all of them".
 */
export function attendDayKeys(b: Pick<Booking, 'attend_days'>): string[] {
  return (b.attend_days ?? [])
    .map(dayKeyOf)
    .filter((k): k is string => !!k)
}

/**
 * Whether this booking puts the diver on site on `dayKey`.
 *
 * The day-level views ask their question the other way round — they load every
 * booking on every event running that day — so a booking with no day limit must
 * answer true. Only an explicit `attend_days` can exclude a day, and only for
 * the days it leaves out.
 */
export function attendsOnDay(b: Pick<Booking, 'attend_days'>, dayKey: string): boolean {
  const days = attendDayKeys(b)
  if (days.length === 0) return true
  return days.includes(dayKey)
}

/** The day-level filter every "who is here on this date" view needs. */
export function bookingsOnDay<T extends Pick<Booking, 'attend_days'>>(bookings: T[], dayKey: string): T[] {
  return bookings.filter(b => attendsOnDay(b, dayKey))
}

/** A course booking of this diver's that a continuation could attach to. */
export interface ContinuableCourse {
  booking: Booking
  eventId: string
  title: string
  /** The course's own days, as date keys — what the "which days did they
   *  actually attend?" trim offers. */
  courseDays: string[]
}

/**
 * This diver's other course bookings, newest course first.
 *
 * Excludes the course being continued onto (they can't continue a course with
 * itself), cancelled bookings, and bookings that are themselves continuations —
 * the money lives on the original, so that's what a third leg must point at.
 */
export async function fetchContinuableCourses(
  userId: string,
  excludeEventId: string,
): Promise<ContinuableCourse[]> {
  const { data: bookingRows, error: bookingError } = await supabase
    .from('bookings').select('*').eq('user_id', userId).neq('status', 'cancelled')
  if (bookingError) throw new Error(bookingError.message)

  const candidates = ((bookingRows ?? []) as Booking[])
    .filter(b => b.event_id !== excludeEventId && !b.continues_booking_id)
  if (!candidates.length) return []

  const { data: eventRows, error: eventError } = await supabase
    .from('events')
    .select('id, kind, display_title, admin_title, course_days')
    .in('id', candidates.map(b => b.event_id))
  if (eventError) throw new Error(eventError.message)

  const courses = new Map(
    ((eventRows ?? []) as Array<{
      id: string; kind: string; display_title: string | null; admin_title: string | null; course_days: string[] | null
    }>)
      .filter(e => e.kind === 'course')
      .map(e => [e.id, e]),
  )

  return candidates
    .flatMap(booking => {
      const event = courses.get(booking.event_id)
      if (!event) return []
      const courseDays = (event.course_days ?? [])
        .map(dayKeyOf)
        .filter((k): k is string => !!k)
        .sort()
      return [{
        booking,
        eventId: event.id,
        title: event.display_title || event.admin_title || '',
        courseDays,
      }]
    })
    // Newest course first: the one they just missed a day of is the one being
    // continued far more often than a course from two seasons ago.
    .sort((a, b) => (b.courseDays[0] ?? '').localeCompare(a.courseDays[0] ?? ''))
}

/**
 * Register `sourceBooking`'s diver onto a second course to finish there.
 *
 * `days` are the days of the target course they'll attend; `sourceDays`, when
 * given, trims the original booking to the days they actually attended (leave
 * it undefined to keep the original as-is). Every rule — subset of the course's
 * days, no double-booking, admin only — is enforced by the RPC; this is the
 * thin wrapper that surfaces its message.
 */
export async function createCourseContinuation(args: {
  sourceBookingId: string
  eventId: string
  days: string[]
  sourceDays?: string[]
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_course_continuation', {
    p_source_booking: args.sourceBookingId,
    p_event_id:       args.eventId,
    p_days:           args.days,
    ...(args.sourceDays ? { p_source_days: args.sourceDays } : {}),
    // The stored charge line reads in the deployment's language, like every
    // other charge label the client writes at registration.
    p_charge_label:   t.admin.continuation.noCharge,
  })
  if (error) throw new Error(error.message)
  return data as string
}
