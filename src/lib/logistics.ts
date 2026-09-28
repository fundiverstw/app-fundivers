import { addDays, format, parseISO } from 'date-fns'
import { shoeAsJp } from './shoe-size'
import { GEAR_TYPES, type GearType } from '../types/database'
import type { Booking, BookingDetails, Profile } from '../types/database'

/** A row carrying at least its booking — enough to read gear + transport. */
type BookingRow = { booking: Booking }

/**
 * Split rows by seat state. Callers pre-filter cancelled bookings, so the
 * remainder is either "seated" (pending/confirmed — has a spot on the boat) or
 * "waitlisted" (no spot yet, so its gear/transport is tentative). Every prep
 * total is computed from `seated`; `waitlisted` is surfaced on its own so staff
 * see the extra load only *if* the waitlist clears. Generic so callers keep
 * their richer row type (DiverGearRow, RegistrantRow, …).
 */
export function partitionByWaitlist<T extends BookingRow>(rows: T[]): { seated: T[]; waitlisted: T[] } {
  const seated: T[] = []
  const waitlisted: T[] = []
  for (const r of rows) {
    if (r.booking.status === 'waitlisted') waitlisted.push(r)
    else seated.push(r)
  }
  return { seated, waitlisted }
}

/** A row carrying its booking + resolved diver profile (logistics view). */
type DiverRow = { booking: Booking; profile: Profile | null }

// "Handle with care" rentals — delicate kit (electronics, lights) that is
// issued separately from the dive bags and tracked per diver so every renter
// gets one back. Two sources feed it:
//   - a gear item the diver rented à-la-carte (Dive computer), and
//   - add-ons whose catalog title matches a care pattern (lights, cameras).
// Add-ons have no category column, so we classify by title and normalize the
// duration variants ("Light Rental (2 Days)") down to one canonical label.
const CARE_GEAR_ITEMS = ['Dive computer'] as const
const CARE_ADDON_PATTERNS: Array<{ label: string; test: RegExp }> = [
  { label: 'Dive light', test: /light/i },
  { label: 'Camera',     test: /camera/i },
]
/** Canonical care-item labels in display order. */
export const CARE_ITEMS = ['Dive computer', 'Dive light', 'Camera'] as const

/** Is this gear item delicate kit? The pack list files it with the other
 *  handle-with-care pieces rather than in the dive bag. */
export function isCareGearItem(item: string): boolean {
  return (CARE_GEAR_ITEMS as readonly string[]).includes(item)
}

/** The canonical care label an add-on title rents ("Light Rental (2 Days)" →
 *  "Dive light"), or null when the add-on is not delicate kit. */
export function careLabelForAddon(title: string): string | null {
  return CARE_ADDON_PATTERNS.find(p => p.test.test(title))?.label ?? null
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
 * The day's transport choices as a HEADCOUNT, not a row count: a diver booked
 * on two of the day's events is one body to move. Rows are keyed by profile,
 * falling back to the booking id when a row has no profile (those can't merge).
 *
 * When one person's rows disagree — a ride to the morning dive, own car to the
 * afternoon course — the more demanding answer wins, since the shop still has
 * to seat them: ride > unspecified > self.
 */
export function transportHeadcount(rows: DiverRow[]): {
  needsRide: number
  selfTransport: number
  unspecified: number
} {
  const rank = { self: 0, unspecified: 1, ride: 2 } as const
  type Choice = keyof typeof rank
  const byPerson = new Map<string, Choice>()
  for (const r of rows) {
    const key = r.profile?.id ?? r.booking.id
    const t = (r.booking.details as BookingDetails | undefined)?.transportation
    const choice: Choice = t === true ? 'ride' : t === false ? 'self' : 'unspecified'
    const prev = byPerson.get(key)
    if (prev === undefined || rank[choice] > rank[prev]) byPerson.set(key, choice)
  }
  const counts = { needsRide: 0, selfTransport: 0, unspecified: 0 }
  for (const c of byPerson.values()) {
    if (c === 'ride') counts.needsRide++
    else if (c === 'self') counts.selfTransport++
    else counts.unspecified++
  }
  return counts
}

// Which profile size column a gear item is packed by. Regulators, masks and
// computers are one-size to the shop, so they have no entry and stay a plain
// count. Substring match, so a fork's relabelled item ("Wetsuit 5mm",
// "Full-foot fins") still resolves to the right column.
const GEAR_SIZE_SOURCE: Array<{ match: string; source: SizedGear }> = [
  { match: 'bcd',     source: 'bcd' },
  { match: 'wetsuit', source: 'wetsuit' },
  { match: 'fin',     source: 'fins' },
  { match: 'boot',    source: 'boots' },
]

export type SizedGear = 'bcd' | 'wetsuit' | 'fins' | 'boots'

/** The size column a gear item is packed by, or null when the item has none. */
export function gearSizeSource(item: string): SizedGear | null {
  const lower = item.toLowerCase()
  return GEAR_SIZE_SOURCE.find(s => lower.includes(s.match))?.source ?? null
}

/**
 * Does preparing this set of items need the diver's shoe size? Fins and boots
 * are the two the shop can't pull off the rack without it, and both register
 * forms ask the same question — of an a-la-carte selection, and of the full
 * set a gear-included course packs unasked.
 */
export function needsShoeSize(items: readonly string[]): boolean {
  return items.some(item => {
    const source = gearSizeSource(item)
    return source === 'fins' || source === 'boots'
  })
}

/** Is this item packed in sizes (so its chip is worth opening)? */
export function isSizedGearItem(item: string): boolean {
  return gearSizeSource(item) !== null
}

/**
 * Which sizing charts a packed set of items calls for. Asked of the items
 * themselves rather than of the catalog, so a shop listing a type in several
 * styles — two boot soles, two wetsuit thicknesses — resolves whichever style
 * was actually rented instead of only the first one the catalog names.
 */
export function packedGearTypes(items: string[]): GearType[] {
  return GEAR_TYPES.filter(gt => items.some(item => gearSizeSource(item) === gt))
}

// Letter sizes sort by the rack order a packer thinks in, not alphabetically
// (which would give L, M, S, XL). Anything unrecognised falls through to the
// numeric/alphabetical tail.
const LETTER_SIZE_ORDER = ['XXS', 'XS', 'S', 'SM', 'M', 'ML', 'L', 'XL', 'XXL', 'XXXL']

function sizeRank(label: string): { tier: number; key: number | string } {
  const letter = LETTER_SIZE_ORDER.indexOf(label.trim().toUpperCase())
  if (letter >= 0) return { tier: 0, key: letter }
  // "JP 26", "5mm", "41" — sort by the first number in the label.
  const num = label.match(/\d+(?:\.\d+)?/)
  if (num) return { tier: 1, key: parseFloat(num[0]) }
  return { tier: 2, key: label.toLowerCase() }
}

/**
 * The size of `item` to pull for this diver, as displayed; null when the item
 * comes in one size, or when it is sized and nothing is on file. Boots read the
 * shoe size normalized to JP, the same way the gear card shows it, so one pair
 * isn't split across "US 9" and "JP 27".
 */
export function gearSizeFor(profile: Profile | null, item: string): string | null {
  const source = gearSizeSource(item)
  if (!source) return null
  const raw =
    source === 'boots'   ? (shoeAsJp(profile?.shoe_size) ?? profile?.shoe_size ?? '')
    : source === 'bcd'     ? (profile?.bcd_size ?? '')
    : source === 'wetsuit' ? (profile?.wetsuit_size ?? '')
    : (profile?.fin_size ?? '')
  return raw.trim() || null
}

/** Rack order for two size labels; an unrecorded size sorts last, because it's
 *  a to-do rather than a slot on the rack. */
export function compareSizes(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  const ra = sizeRank(a), rb = sizeRank(b)
  if (ra.tier !== rb.tier) return ra.tier - rb.tier
  return typeof ra.key === 'number' && typeof rb.key === 'number'
    ? ra.key - rb.key
    : String(ra.key).localeCompare(String(rb.key))
}

/** Shift a 'YYYY-MM-DD' day key by n calendar days, returning 'YYYY-MM-DD'.
 *  Pure date arithmetic on the calendar day — no timezone drift. */
export function dayKeyOffset(dayKey: string, n: number): string {
  return format(addDays(parseISO(dayKey), n), 'yyyy-MM-dd')
}
