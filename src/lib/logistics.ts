import { addDays, format, parseISO } from 'date-fns'
import { GEAR_ITEMS, gearPackList } from './gear'
import { personName } from './names'
import { shoeAsJp } from './shoe-size'
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

/** Is this item packed in sizes (so its chip is worth opening)? */
export function isSizedGearItem(item: string): boolean {
  return gearSizeSource(item) !== null
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

export interface GearSizeGroup {
  /** The size as it will be displayed; null = no size recorded for that diver. */
  size: string | null
  divers: Array<{ bookingId: string; name: string }>
}

/**
 * For one gear item, the sizes the day actually needs and who each one is for —
 * what a packer reads off the rack ("BCD: M ×2, L ×1, one unknown"). Rows
 * without the item are skipped; a diver with no size on file lands in the
 * trailing `size: null` group rather than being dropped, because an unknown
 * size is the thing the shop most needs to chase before the van leaves.
 *
 * Boots are keyed off the diver's shoe size, normalised to JP the same way the
 * gear card shows it, so one pair of boots isn't counted twice under "US 9" and
 * "JP 27". Sizes are grouped case-insensitively and shown in rack order.
 */
export function gearSizeBreakdown(rows: DiverRow[], item: string): GearSizeGroup[] {
  const source = gearSizeSource(item)
  if (!source) return []
  const groups = new Map<string, GearSizeGroup>()
  for (const r of rows) {
    if (!gearPackList(r.booking).items.includes(item)) continue
    const raw =
      source === 'boots'   ? (shoeAsJp(r.profile?.shoe_size) ?? r.profile?.shoe_size ?? '')
      : source === 'bcd'     ? (r.profile?.bcd_size ?? '')
      : source === 'wetsuit' ? (r.profile?.wetsuit_size ?? '')
      : (r.profile?.fin_size ?? '')
    const label = raw.trim()
    const key = label ? label.toUpperCase() : ''
    const group = groups.get(key) ?? { size: label || null, divers: [] }
    group.divers.push({
      bookingId: r.booking.id,
      name: personName(r.profile?.name, r.profile?.nickname) || '(no profile)',
    })
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) => compareSizes(a.size, b.size))
}

/** Rack order for two size labels; an unrecorded size sorts last, because it's
 *  a to-do rather than a slot on the rack. */
function compareSizes(a: string | null, b: string | null): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  const ra = sizeRank(a), rb = sizeRank(b)
  if (ra.tier !== rb.tier) return ra.tier - rb.tier
  return typeof ra.key === 'number' && typeof rb.key === 'number'
    ? ra.key - rb.key
    : String(ra.key).localeCompare(String(rb.key))
}

/** One rack slot on one day: the size (or none) and who needs it. */
interface GearUnits {
  size: string | null
  unknownSize: boolean
  divers: string[]
}

// A day's gear reduced to countable rack slots, keyed item → size key. Sized
// items split per size (that's the granularity a piece is reused at — an M BCD
// covers tomorrow's M diver, not their L colleague); one-size items collapse to
// a single bucket. '' keys both the unsized bucket and the no-size-on-file one,
// which never collide since an item is one or the other.
function gearUnitsByItem(rows: DiverRow[]): Map<string, Map<string, GearUnits>> {
  const byItem = new Map<string, Map<string, GearUnits>>()
  for (const { item } of gearTotals(rows)) {
    const bucket = new Map<string, GearUnits>()
    if (isSizedGearItem(item)) {
      for (const g of gearSizeBreakdown(rows, item)) {
        bucket.set(g.size ? g.size.toUpperCase() : '', {
          size: g.size,
          unknownSize: g.size === null,
          divers: g.divers.map(d => d.name),
        })
      }
    } else {
      bucket.set('', {
        size: null,
        unknownSize: false,
        divers: rows
          .filter(r => gearPackList(r.booking).items.includes(item))
          .map(r => personName(r.profile?.name, r.profile?.nickname) || '(no profile)'),
      })
    }
    byItem.set(item, bucket)
  }
  return byItem
}

export interface GearDiffLine {
  item: string
  /** The size as displayed; null when the item has no size dimension at all,
   *  and also when it has one but no size is on file — see `unknownSize`. */
  size: string | null
  /** True only when the item IS packed in sizes but none is recorded. */
  unknownSize: boolean
  /** Pieces this size is needed in today, and on the next day. */
  today: number
  next: number
  /** Pieces already out that the next day reuses. */
  keep: number
  /** Pieces the next day needs on top of what's already out. */
  add: number
  /** Pieces out today that the next day has no use for. */
  free: number
  /** Who needs this item+size on the next day. */
  nextDivers: string[]
}

export interface GearDayDiff {
  lines: GearDiffLine[]
  /** Counts over placeable pieces only — lines with a size the shop can pull.
   *  An unsized piece is not a rack slot, so it is counted in `unsized`. */
  keep: number
  add: number
  free: number
  /** Pieces neither day can place: no size on file for that diver. */
  unsized: number
}

/**
 * What today's packed gear leaves to do for the next day — the overlap a shop
 * running back-to-back days cares about. Per item and per size: what stays on
 * the van (`keep`), what still has to be pulled off the rack (`add`), and what
 * comes home to dry because nobody needs it tomorrow (`free`).
 *
 * Sizes are the unit of reuse, not items: three BCDs out today only cover
 * tomorrow if they're the sizes tomorrow wears. A piece whose diver has no size
 * on file never counts as reusable — the shop can't promise an unknown matches
 * anything — so it lands wholly in `add` (next day) and `free` (today), which
 * is also the nudge to go and record the size.
 *
 * Both sides should be seated rows only, matching every other prep total: a
 * waitlisted diver's gear isn't packed, so it can't be kept out either.
 */
export function gearDayDiff(todayRows: DiverRow[], nextRows: DiverRow[]): GearDayDiff {
  const todayUnits = gearUnitsByItem(todayRows)
  const nextUnits = gearUnitsByItem(nextRows)
  const lines: GearDiffLine[] = []
  for (const item of GEAR_ITEMS) {
    const a = todayUnits.get(item)
    const b = nextUnits.get(item)
    if (!a && !b) continue
    const keys = [...new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])])]
    const units = keys
      .map(key => ({ key, unit: (a?.get(key) ?? b?.get(key))! }))
      .sort((x, y) => compareSizes(x.unit.size, y.unit.size))
    for (const { key, unit } of units) {
      const today = a?.get(key)?.divers.length ?? 0
      const next = b?.get(key)?.divers.length ?? 0
      const keep = unit.unknownSize ? 0 : Math.min(today, next)
      lines.push({
        item,
        size: unit.size,
        unknownSize: unit.unknownSize,
        today,
        next,
        keep,
        add: next - keep,
        free: today - keep,
        nextDivers: b?.get(key)?.divers ?? [],
      })
    }
  }
  // Sized and unsized lines are counted apart. Mixing them reads as a broken
  // diff: one diver with no size on file contributes an unsized line to every
  // sized item they rent (BCD, wetsuit, fins, boots at once), and since those
  // can never match, they are the only thing left in "also pack" once everyone
  // who IS sized has quietly cancelled out into "stays out".
  const sized = lines.filter(l => !l.unknownSize)
  return {
    lines,
    keep: sized.reduce((s, l) => s + l.keep, 0),
    add: sized.reduce((s, l) => s + l.add, 0),
    free: sized.reduce((s, l) => s + l.free, 0),
    unsized: lines.filter(l => l.unknownSize).reduce((s, l) => s + Math.max(l.today, l.next), 0),
  }
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
