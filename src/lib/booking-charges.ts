import { GEAR_ALACARTE_PRICES } from './gear'
import { siteConfig } from '../config/site'
import type { AppEvent, BookingDetails } from '../types/database'
import { t } from '../i18n'

// Flat fee for adding a Nitrox course to a dive registration, from shop config.
// Shared by both register forms and the display-time recompute so the figure
// lives in exactly one place.
export const NITROX_COURSE_FEE = siteConfig.business.nitroxCourseFee

export type ChargeKind =
  | 'base'
  | 'gear'
  | 'room'
  | 'addon'
  | 'transport'
  | 'nitrox_course'
  | 'surcharge'
  | 'adjustment'

/** One line of a booking's itemized charge breakdown. Snapshotted into
 *  bookings.details.charges at registration so later catalog price changes
 *  can't retroactively alter what a diver was charged. */
export interface ChargeLine {
  kind: ChargeKind
  label: string
  amount: number
}

export interface BuildChargesInput {
  base: number
  /** Per-item gear lines; `amount` is the item's price already multiplied by
   *  the number of dive days. */
  gear?: Array<{ item: string; amount: number }>
  /** Dive-day count, only used to suffix gear labels (" (x3 days)"). */
  gearDays?: number
  room?: { label: string; amount: number } | null
  addons?: Array<{ label: string; amount: number }>
  transport?: number
  nitroxCourse?: number
  surcharge?: { label: string; amount: number } | null
}

/**
 * Assemble the ordered charge lines from already-resolved amounts. The single
 * source of truth for line order and labels — fed both by the register forms
 * (snapshot) and by resolveCharges (display-time recompute for old bookings).
 * Base is always shown; every other line is dropped when it's zero/empty.
 */
export function buildCharges(input: BuildChargesInput): ChargeLine[] {
  const lines: ChargeLine[] = [{ kind: 'base', label: t.chargeLines.base, amount: input.base }]
  const daySuffix = input.gearDays && input.gearDays > 1 ? ` (x${input.gearDays} days)` : ''
  for (const g of input.gear ?? []) {
    if (g.amount > 0) lines.push({ kind: 'gear', label: `Gear: ${g.item}${daySuffix}`, amount: g.amount })
  }
  if (input.room && input.room.amount > 0) {
    lines.push({ kind: 'room', label: `Room: ${input.room.label}`, amount: input.room.amount })
  }
  for (const a of input.addons ?? []) {
    if (a.amount > 0) lines.push({ kind: 'addon', label: `Add-on: ${a.label}`, amount: a.amount })
  }
  if (input.transport && input.transport > 0) {
    lines.push({ kind: 'transport', label: t.chargeLines.transport, amount: input.transport })
  }
  if (input.nitroxCourse && input.nitroxCourse > 0) {
    lines.push({ kind: 'nitrox_course', label: t.chargeLines.nitroxCourse, amount: input.nitroxCourse })
  }
  if (input.surcharge && input.surcharge.amount > 0) {
    lines.push({ kind: 'surcharge', label: input.surcharge.label, amount: input.surcharge.amount })
  }
  return lines
}

export function chargesTotal(lines: ChargeLine[]): number {
  return lines.reduce((s, l) => s + l.amount, 0)
}

const surchargeRate = (method: BookingDetails['payment_method']): number =>
  method === 'credit_card' || method === 'paypal' ? 0.05 : 0

export interface ResolveChargesInput {
  details: BookingDetails | null | undefined
  event: Pick<AppEvent, 'price' | 'transport_price' | 'dive_days' | 'deposit_amount'> | null | undefined
  /** option_id -> resolved room label + added_price. Only needed for old
   *  bookings (no snapshot); pass an empty map otherwise. */
  roomPrices?: Map<string, { label: string; amount: number }>
  /** addon _id -> resolved label + price. Same — only for old bookings. */
  addonPrices?: Map<string, { label: string; amount: number }>
}

/**
 * Return a booking's itemized charge lines. Prefers the snapshot stored at
 * registration (details.charges); for older bookings that predate the snapshot
 * it reconstructs the lines from the stored selections using *current* catalog
 * prices. Recomputed lines can drift from the frozen details.total if prices
 * have since changed — that's the accepted trade-off for showing old bookings
 * an itemized view. This never mutates stored data.
 */
export function resolveCharges(input: ResolveChargesInput): ChargeLine[] {
  const { details, event } = input
  if (details?.charges?.length) return details.charges
  if (!details || !event) return []

  const base = event.price ?? 0
  const days = Math.max(1, event.dive_days ?? 1)
  const gear = (details.gear?.rent ? details.gear.items ?? [] : [])
    .map(item => ({ item, amount: (GEAR_ALACARTE_PRICES[item] ?? 0) * days }))
  const roomId = details.room?.option_id ?? null
  const room = roomId ? input.roomPrices?.get(roomId) ?? { label: roomId, amount: 0 } : null
  const addons = (details.add_ons ?? []).map(id => input.addonPrices?.get(id) ?? { label: id, amount: 0 })
  const transport = (event.transport_price ?? 0) > 0 && details.transportation ? event.transport_price ?? 0 : 0
  const nitroxCourse = details.nitrox_course_addon ? NITROX_COURSE_FEE : 0

  const subTotal = base
    + gear.reduce((s, g) => s + g.amount, 0)
    + (room?.amount ?? 0)
    + addons.reduce((s, a) => s + a.amount, 0)
    + transport + nitroxCourse

  const rate = surchargeRate(details.payment_method)
  let surcharge: { label: string; amount: number } | null = null
  if (rate > 0) {
    const depositOnly = !!details.pay_deposit_only
    const surchargeBase = depositOnly ? Math.min(event.deposit_amount ?? 0, subTotal) : subTotal
    surcharge = {
      // The rate is business.cardSurchargePercent; it used to be a hardcoded 5%.
      label: t.chargeLines.surcharge(siteConfig.business.cardSurchargePercent, depositOnly),
      amount: Math.round(surchargeBase * rate),
    }
  }

  const lines = buildCharges({ base, gear, gearDays: days, room, addons, transport, nitroxCourse, surcharge })

  // Legacy reconciliation: this booking predates the snapshot, so the lines
  // above are rebuilt from *current* prices and may not sum to what was
  // actually charged (e.g. gear booked as the since-removed full-set package).
  // Rather than silently show two conflicting totals, tie the breakdown back to
  // the recorded total with an explicit, labelled adjustment so the reason for
  // the difference is transparent.
  if (details.total != null) {
    const diff = details.total - chargesTotal(lines)
    if (diff !== 0) {
      lines.push({
        kind: 'adjustment',
        label: t.chargeLines.legacyAdjustment,
        amount: diff,
      })
    }
  }

  return lines
}
