import type { ChargeLine } from './booking-charges'
import { chargesTotal } from './booking-charges'

// Cost-estimate math shared by the registration flows that quote a non-binding
// price: partner-shop Packages and the shop's own Scheduled Trips. Add-ons are
// charged per day, the room per night, over the relevant date range. The
// estimate is a quote — the final cost is confirmed by the shop / partner.
//
// This mirrors supabase/functions/_shared/registration-estimate.ts (the
// authoritative server-side recompute); registration-estimate.test.ts asserts
// the two stay in sync.

export interface EstimateItem {
  label: string
  /** Single-day (add-on) / single-night (room) catalog price. */
  price: number
}

export interface RegistrationEstimateInput {
  /** The base line label, e.g. "Package: Deluxe" or "Trip". */
  baseLabel: string
  /** The base price (a package tier's price, or a trip's single price). */
  basePrice: number
  /** Selected add-ons at their per-day catalog price. */
  addons: EstimateItem[]
  /** Selected room at its per-night price, or null when none is chosen. */
  room: EstimateItem | null
  days: number
  nights: number
}

/**
 * Derive nights (the span of the range) and days (nights + 1) from a date range.
 * A same-day range is 0 nights / 1 day. An absent or invalid range yields 0 / 0
 * so the estimate shows the base price alone until dates are known.
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
 * Itemized estimate lines in the shared ChargeLine shape: the base, each selected
 * add-on × days, then the room × nights. Zero-amount lines are dropped (so add-ons
 * before a date range is known don't appear).
 */
export function buildRegistrationCharges(input: RegistrationEstimateInput): ChargeLine[] {
  const { baseLabel, basePrice, addons, room, days, nights } = input
  const dayMult = Math.max(0, days)
  const nightMult = Math.max(0, nights)
  const lines: ChargeLine[] = [{ kind: 'base', label: baseLabel, amount: basePrice }]
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
