import type { Booking } from '../types/database'
import { siteConfig } from '../config/site'

// Canonical list of rental-gear items, shared between the profile's "Gear I
// own" checklist and the register-form a-la-carte checklist so the two
// sides can be matched 1:1 (items you own are excluded from rental). Set per
// shop in fundive.config.ts.
export const GEAR_ITEMS = siteConfig.business.gearItems

// Per-item daily rental price (shop currency). Gear is rented à-la-carte only —
// the diver picks exactly the items they need and pays per item per dive day.
export const GEAR_ALACARTE_PRICES: Record<string, number> = siteConfig.business.gearPrices

// Two catalog entries that differ only by a trailing parenthesised qualifier
// fill the same slot on a diver: "Boots (rubber sole)" and "Boots (felt sole)"
// are one pair of feet, and a fork's "Wetsuit (3mm)" / "Wetsuit (5mm)" is one
// torso. A shop stocks both styles because they are not interchangeable in the
// water — felt grips algae-covered rock on a shore entry, rubber is for boats,
// sand and walking — but a diver rents one or the other, never both.
export function gearSlot(item: string): string {
  return item.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase()
}

/** The other catalog entries that fill the same slot as `item`. */
export function gearAlternatives(item: string): string[] {
  const slot = gearSlot(item)
  return (GEAR_ITEMS as readonly string[]).filter(i => i !== item && gearSlot(i) === slot)
}

/** Does this shop's catalog offer any item in more than one style? Drives the
 *  hint that explains why ticking one style clears the other. */
export const HAS_GEAR_ALTERNATIVES =
  (GEAR_ITEMS as readonly string[]).some(item => gearAlternatives(item).length > 0)

/**
 * What the à-la-carte checklist starts ticked with: everything the diver
 * doesn't already own. A slot they own in *any* style is dropped whole — a
 * diver with felt boots is not defaulted into renting rubber ones — and a slot
 * they own nothing in defaults to the first style the shop lists, so nobody is
 * quietly charged for two pairs of boots they never chose.
 */
export function defaultRentalItems(owned: string[] | null | undefined): string[] {
  const ownedSlots = new Set((owned ?? []).map(gearSlot))
  const taken = new Set<string>()
  return (GEAR_ITEMS as readonly string[]).filter(item => {
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
 */
export function toggleGearSelection(current: string[], item: string): string[] {
  if (current.includes(item)) return current.filter(i => i !== item)
  const alternatives = new Set(gearAlternatives(item))
  return [...current.filter(i => !alternatives.has(i)), item]
}

// One of every slot — what "a full set" means once an item comes in styles.
// Packing GEAR_ITEMS raw would put both boot styles on the van for one diver.
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
