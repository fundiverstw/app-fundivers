// Canonical list of rental-gear items, shared between the profile's "Gear I
// own" checklist and the register-form a-la-carte checklist so the two
// sides can be matched 1:1 (items you own are excluded from rental).
export const GEAR_ITEMS = ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots', 'Dive computer'] as const

// Per-item daily rental price (NTD). Gear is rented à-la-carte only — the
// diver picks exactly the items they need and pays per item per dive day.
export const GEAR_ALACARTE_PRICES: Record<string, number> = {
  BCD: 400, Regulator: 500, Wetsuit: 200, Fins: 150, Mask: 100, Boots: 50, 'Dive computer': 250,
}

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
