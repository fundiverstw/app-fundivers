import { addDays, format, parseISO } from 'date-fns'
import { GEAR_ITEMS, gearPackList } from './gear'
import type { Booking, BookingDetails } from '../types/database'

/** A row carrying at least its booking — enough to read gear + transport. */
type BookingRow = { booking: Booking }

/**
 * Split rows by the diver's transport choice (booking.details.transportation):
 * true → needs a ride, false → self-transport, missing → unspecified (legacy
 * bookings from before transport was a required question). Caller pre-filters
 * cancelled bookings. Generic so callers keep their richer row type.
 */
export function splitByTransport<T extends BookingRow>(rows: T[]): {
  needsRide: T[]
  selfTransport: T[]
  unspecified: T[]
} {
  const needsRide: T[] = []
  const selfTransport: T[] = []
  const unspecified: T[] = []
  for (const r of rows) {
    const t = (r.booking.details as BookingDetails | undefined)?.transportation
    if (t === true) needsRide.push(r)
    else if (t === false) selfTransport.push(r)
    else unspecified.push(r)
  }
  return { needsRide, selfTransport, unspecified }
}

/**
 * How many of each gear item the shop must pack across a set of bookings,
 * ordered by the canonical GEAR_ITEMS list. Items nobody needs are omitted.
 */
export function gearTotals(rows: BookingRow[]): Array<{ item: string; count: number }> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    for (const item of gearPackList(r.booking).items) {
      counts.set(item, (counts.get(item) ?? 0) + 1)
    }
  }
  return GEAR_ITEMS
    .map(item => ({ item, count: counts.get(item) ?? 0 }))
    .filter(x => x.count > 0)
}

/** Shift a 'YYYY-MM-DD' day key by n calendar days, returning 'YYYY-MM-DD'.
 *  Pure date arithmetic on the calendar day — no timezone drift. */
export function dayKeyOffset(dayKey: string, n: number): string {
  return format(addDays(parseISO(dayKey), n), 'yyyy-MM-dd')
}
