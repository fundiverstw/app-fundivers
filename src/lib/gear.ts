import type { Booking } from '../types/database'
import { siteConfig } from '../config/site'

// Canonical list of gear items, set per shop in fundive.config.ts. This is the
// catalog a diver describes themselves against — the profile's "Gear I own"
// checklist — so it covers what divers turn up carrying, not only what the shop
// keeps on the rental rack.
export const GEAR_ITEMS = siteConfig.business.gearItems

// Per-item daily rental price (shop currency). Gear is rented à-la-carte only —
// the diver picks exactly the items they need and pays per item per dive day.
export const GEAR_ALACARTE_PRICES: Record<string, number> = siteConfig.business.gearPrices

/**
 * What the shop actually rents. A catalog item with no rental price is
 * owned-only: it stays on the profile checklist, so a diver can record that
 * they own a pair, and never appears in the register form's rental list.
 *
 * FunDivers is the case this exists for. It stocks felt soles on the rack
 * because the shore entries here are algae-covered rock, and rubber ones are a
 * pair divers bring rather than borrow.
 */
export const RENTAL_GEAR_ITEMS = (GEAR_ITEMS as readonly string[]).filter(item =>
  Object.hasOwn(GEAR_ALACARTE_PRICES, item),
)

// Two catalog entries that differ only by a trailing parenthesised qualifier
// fill the same slot on a diver: "Boots (rubber sole)" and "Boots (felt sole)"
// are one pair of feet, and a fork's "Wetsuit (3mm)" / "Wetsuit (5mm)" is one
// torso. A shop stocks both styles because they are not interchangeable in the
// water — felt grips algae-covered rock on a shore entry, rubber is for boats,
// sand and walking — but a diver rents one or the other, never both.
export function gearSlot(item: string): string {
  return item.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
}

/** The other entries in `within` that fill the same slot as `item`. Defaults to
 *  the whole catalog; pass the rental list to ask what a booking can swap for. */
export function gearAlternatives(item: string, within: readonly string[] = GEAR_ITEMS): string[] {
  const slot = gearSlot(item)
  return within.filter(i => i !== item && gearSlot(i) === slot)
}

/** Does the catalog list any item in more than one style? Drives the profile
 *  hint that asks the diver to tick every style they own. */
export const HAS_GEAR_ALTERNATIVES =
  (GEAR_ITEMS as readonly string[]).some(item => gearAlternatives(item).length > 0)

/** Does the shop *rent* any item in more than one style? Drives the register
 *  hint that explains why ticking one style clears the other — a shop that
 *  rents a single style has nothing to explain. */
export const HAS_RENTAL_GEAR_ALTERNATIVES =
  RENTAL_GEAR_ITEMS.some(item => gearAlternatives(item, RENTAL_GEAR_ITEMS).length > 0)

/** Does the catalog hold anything the shop doesn't rent? Drives the line that
 *  tells a diver the rental list is the whole rack, not a shortened menu. */
export const HAS_OWNED_ONLY_GEAR = RENTAL_GEAR_ITEMS.length < GEAR_ITEMS.length

/**
 * What the à-la-carte checklist starts ticked with: everything the shop rents
 * that the diver doesn't already own. A slot they own in *any* style is dropped
 * whole — a diver who owns rubber-soled boots isn't defaulted into renting felt
 * ones, though they can still tick them for a dive that wants the grip — and a
 * slot they own nothing in defaults to the first style the shop rents, so nobody
 * is quietly charged for two pairs of boots they never chose.
 */
export function defaultRentalItems(owned: string[] | null | undefined): string[] {
  const ownedSlots = new Set((owned ?? []).map(gearSlot))
  const taken = new Set<string>()
  return RENTAL_GEAR_ITEMS.filter(item => {
    const slot = gearSlot(item)
    if (ownedSlots.has(slot) || taken.has(slot)) return false
    taken.add(slot)
    return true
  })
}

/**
 * Tick or untick one item in the à-la-carte checklist. Ticking a style unticks
 * the others in its slot, so the running total can never bill for two pairs of
 * boots at once.
 *
 * Alternatives are read from the whole catalog, not just the rental list: a
 * selection carried in from an older booking can name a style the shop has since
 * stopped renting, and the checklist no longer draws a box to untick it with.
 * Ticking the style that replaced it clears it.
 */
export function toggleGearSelection(current: string[], item: string): string[] {
  if (current.includes(item)) return current.filter(i => i !== item)
  const alternatives = new Set(gearAlternatives(item))
  return [...current.filter(i => !alternatives.has(i)), item]
}

// One of every slot the shop rents — what "a full set" means once an item comes
// in styles. Packing GEAR_ITEMS raw would put both boot styles on the van for
// one diver, and a style the shop doesn't stock for rental at all.
export const FULL_GEAR_SET = defaultRentalItems([])

// Courses that don't prompt for gear rental: Open Water and Discover Scuba
// (DSD / "Try Dive") bundle a full set into the fee (those divers don't own
// gear yet), and EFR is a dry first-aid course that needs none. Every other
// course (Advanced Open Water, EANx/Nitrox, Deep, Rescue, Equipment, ...) is
// for already-certified divers, so they rent gear like a fun dive. Courses
// carry no structured type column, so classify by the customer-facing title.
export function isGearIncludedCourse(title: string | null | undefined): boolean {
  const t = (title ?? '').toLowerCase()
  const isOpenWater = t.includes('open water') && !t.includes('advanced')
  const isDiscoverScuba = t.includes('discover scuba') || /\bdsd\b/.test(t) || t.includes('try dive')
  const isEfr = /\befr\b/.test(t) || t.includes('emergency first response')
  return isOpenWater || isDiscoverScuba || isEfr
}

/**
 * What the shop physically packs for a diver, derived from the booking-time
 * gear selection (`details.gear`) — NOT profile.gear_owned. The diver's
 * registration choice is the source of truth for what to load on the van.
 *  - course-bundled gear (`included`) packs as a full set
 *  - "needs help" surfaces the diver's note; nothing to pack until resolved
 *  - à-la-carte packs exactly the chosen items
 */
export function gearPackList(booking: Booking): { summary: string; items: string[]; note?: string } {
  const g = booking.details?.gear
  if (!g) return { summary: 'Own gear', items: [] }
  if (g.included) return { summary: 'Included with course', items: [...FULL_GEAR_SET] }
  if (g.assistance_note) return { summary: 'Needs help', items: [], note: g.assistance_note }
  if (!g.rent) return { summary: 'Own gear', items: [] }
  return {
    summary: g.items?.length ? `À-la-carte (${g.items.length})` : 'À-la-carte (none)',
    items: g.items ?? [],
  }
}
