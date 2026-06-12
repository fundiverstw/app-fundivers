// Canonical list of rental-gear items, shared between the profile's "Gear I
// own" checklist and the register-form a-la-carte checklist so the two
// sides can be matched 1:1 (items you own are excluded from rental).
export const GEAR_ITEMS = ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots', 'Dive computer'] as const

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
