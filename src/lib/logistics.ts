import { addDays, format, parseISO } from 'date-fns'
import { GEAR_ITEMS, gearPackList } from './gear'
import { personName } from './names'
import type { Booking, BookingDetails, Profile } from '../types/database'

/** A row carrying at least its booking — enough to read gear + transport. */
type BookingRow = { booking: Booking }

/** A row carrying its booking + resolved diver profile (logistics view). */
type DiverRow = { booking: Booking; profile: Profile | null }

// "Handle with care" rentals — delicate kit (electronics, lights) that is
// issued separately from the dive bags and tracked per diver so every renter
// gets one back. Two sources feed it:
//   - a gear item the diver rented à-la-carte (Dive computer), and
//   - add-ons whose catalog title matches a care pattern (lights, cameras).
// Add-ons have no category column, so we classify by title and normalise the
// duration variants ("Light Rental (2 Days)") down to one canonical label.
const CARE_GEAR_ITEMS = ['Dive computer'] as const
const CARE_ADDON_PATTERNS: Array<{ label: string; test: RegExp }> = [
  { label: 'Dive light', test: /light/i },
  { label: 'Camera',     test: /camera/i },
]
/** Canonical care-item labels in display order. */
export const CARE_ITEMS = ['Dive computer', 'Dive light', 'Camera'] as const

/** Is this a care item that's also a standard gear piece? Used to drop it from
 *  the "Gear to pack" chips so it shows only in the care inventory. */
export function isCareGearItem(item: string): boolean {
  return (CARE_GEAR_ITEMS as readonly string[]).includes(item)
}

/** The canonical care-item labels one booking includes (deduped). Needs the
 *  add-on id → catalog-title map for the day's bookings. */
export function careItemsForBooking(booking: Booking, addonTitleById: Map<string, string>): string[] {
  const out = new Set<string>()
  const gear = gearPackList(booking).items
  for (const ci of CARE_GEAR_ITEMS) if (gear.includes(ci)) out.add(ci)
  for (const id of (booking.details as BookingDetails | undefined)?.add_ons ?? []) {
    const title = addonTitleById.get(id) ?? ''
    for (const p of CARE_ADDON_PATTERNS) if (p.test.test(title)) out.add(p.label)
  }
  return [...out]
}

/**
 * Per care item, the divers who rented it — a hand-out checklist so staff can
 * confirm every renter gets (and returns) their piece. Ordered by CARE_ITEMS;
 * items nobody rented are omitted.
 */
export function careTotals(
  rows: DiverRow[],
  addonTitleById: Map<string, string>,
): Array<{ item: string; divers: Array<{ bookingId: string; name: string }> }> {
  const byItem = new Map<string, Array<{ bookingId: string; name: string }>>()
  for (const r of rows) {
    const name = personName(r.profile?.name, r.profile?.nickname) || '(no profile)'
    for (const item of careItemsForBooking(r.booking, addonTitleById)) {
      const arr = byItem.get(item) ?? []
      arr.push({ bookingId: r.booking.id, name })
      byItem.set(item, arr)
    }
  }
  return CARE_ITEMS
    .filter(item => byItem.has(item))
    .map(item => ({ item, divers: byItem.get(item)! }))
}

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

/**
 * Every add-on rented across a set of bookings, by catalog title, with how
 * many divers bought each — the full prep list for an event (SMBs, extra
 * wetsuits, nitrox tanks, course upgrades, …). Titles with no resolved name
 * are skipped. Ordered alphabetically so the list is stable.
 */
export function addonTotals(
  rows: BookingRow[],
  addonTitleById: Map<string, string>,
): Array<{ title: string; count: number }> {
  const counts = new Map<string, number>()
  for (const r of rows) {
    for (const id of (r.booking.details as BookingDetails | undefined)?.add_ons ?? []) {
      const title = addonTitleById.get(id)
      if (!title) continue
      counts.set(title, (counts.get(title) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

/** Shift a 'YYYY-MM-DD' day key by n calendar days, returning 'YYYY-MM-DD'.
 *  Pure date arithmetic on the calendar day — no timezone drift. */
export function dayKeyOffset(dayKey: string, n: number): string {
  return format(addDays(parseISO(dayKey), n), 'yyyy-MM-dd')
}
