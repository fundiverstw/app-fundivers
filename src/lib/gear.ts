// Canonical list of rental-gear items, shared between the profile's "Gear I
// own" checklist and the register-form a-la-carte checklist so the two
// sides can be matched 1:1 (items you own are excluded from rental).
export const GEAR_ITEMS = ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots'] as const

export type GearItem = (typeof GEAR_ITEMS)[number]

export function isGearItem(s: string): s is GearItem {
  return (GEAR_ITEMS as readonly string[]).includes(s)
}
