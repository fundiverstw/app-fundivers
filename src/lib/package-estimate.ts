import type { ChargeLine } from './booking-charges'
import { chargesTotal } from './booking-charges'

// Cost-estimate math for partner-shop package registrations. The estimate is a
// non-binding quote — the final cost is set by the partner shop. Add-ons are
// charged per day, the room per night, over the diver's preferred date range.
//
// This mirrors supabase/functions/_shared/package-estimate.ts (the authoritative
// server-side recompute); package-estimate.test.ts asserts the two stay in sync.

export interface PackageEstimateItem {
  label: string
  /** Single-day (add-on) / single-night (room) catalog price. */
  price: number
}

export interface PackageEstimateInput {
  tierName: string
  tierPrice: number
  /** Selected add-ons at their per-day catalog price. */
  addons: PackageEstimateItem[]
  /** Selected room at its per-night price, or null when none is chosen. */
  room: PackageEstimateItem | null
  days: number
  nights: number
}

/**
 * Derive nights (the span of the range) and days (nights + 1) from a preferred
 * date range. A same-day range is 0 nights / 1 day. An absent or invalid range
 * yields 0 / 0 so the estimate shows the tier price alone until dates are set.
 */
export function rangeDaysNights(
  start: string | null | undefined,
  end: string | null | undefined,
): { days: number; nights: number } {
  if (!start || !end) return { days: 0, nights: 0 }
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)
  if (!Number.isFinite(ms) || ms < 0) return { days: 0, nights: 0 }
  const nights = Math.round(ms / 86_400_000)
  return { days: nights + 1, nights }
}

/**
 * Itemized estimate lines in the shared ChargeLine shape: the tier base, each
 * selected add-on × days, then the room × nights. Zero-amount lines are dropped
 * (so add-ons before a date range is picked don't appear).
 */
export function buildPackageCharges(input: PackageEstimateInput): ChargeLine[] {
  const { tierName, tierPrice, addons, room, days, nights } = input
  const dayMult = Math.max(0, days)
  const nightMult = Math.max(0, nights)
  const lines: ChargeLine[] = [
    { kind: 'base', label: tierName ? `Package: ${tierName}` : 'Package', amount: tierPrice },
  ]
  const daySuffix = dayMult > 1 ? ` (x${dayMult} days)` : ''
  for (const a of addons) {
    const amount = (a.price || 0) * dayMult
    if (amount > 0) lines.push({ kind: 'addon', label: `Add-on: ${a.label}${daySuffix}`, amount })
  }
  if (room) {
    const nightSuffix = nightMult > 1 ? ` (x${nightMult} nights)` : ''
    const amount = (room.price || 0) * nightMult
    if (amount > 0) lines.push({ kind: 'room', label: `Room: ${room.label}${nightSuffix}`, amount })
  }
  return lines
}

/** Sum of the estimate lines — the headline "estimated cost". */
export function estimateTotal(lines: ChargeLine[]): number {
  return chargesTotal(lines)
}
