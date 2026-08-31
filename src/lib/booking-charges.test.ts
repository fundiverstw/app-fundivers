import { describe, it, expect } from 'vitest'
import { buildCharges, chargesTotal, resolveCharges, surchargeLine, NITROX_COURSE_FEE } from './booking-charges'
import { surchargeRateFor } from './payment-method-format'
import type { PaymentMethod } from '../types/database'
import { GEAR_ALACARTE_PRICES, FULL_GEAR_SET } from './gear'
import type { AppEvent, BookingDetails } from '../types/database'
import { siteConfig } from '../config/site'
import { t } from '../i18n'
import { computeBookingMoney } from '../../supabase/functions/_shared/booking-charges'

// The shop's payment methods are DB rows now, so the tests that used to name a
// hardcoded 'credit_card' arm build the row they mean and hand it in.
function method(over: Partial<PaymentMethod> & { key: string; label: string }): PaymentMethod {
  return {
    id: over.key, created_at: '2026-01-01T00:00:00Z', created_by: null,
    blurb: null, surcharge_percent: 0,
    bank_name: null, bank_branch: null, bank_code: null,
    account_number: null, account_holder: null, swift_bic: null,
    pay_url: null, notes: null,
    collects_invoice_email: false, shows_shop_contact: false,
    sort_order: 0, active: true,
    ...over,
  } as PaymentMethod
}

const CARD = method({ key: 'credit_card', label: 'Credit card', surcharge_percent: 5 })
const CASH = method({ key: 'cash', label: 'Cash' })
const TRANSFER = method({ key: 'bank_transfer', label: 'Domestic bank transfer' })
const METHODS = new Map([CARD, CASH, TRANSFER].map(m => [m.key, m]))

describe('buildCharges', () => {
  it('always emits a base line and drops zero/empty lines', () => {
    const lines = buildCharges({ base: 2800 })
    expect(lines).toEqual([{ kind: 'base', label: 'Base', amount: 2800 }])
  })

  it('orders lines base → gear → room → add-ons → transport → nitrox → surcharge', () => {
    const lines = buildCharges({
      base: 2800,
      gear: [{ item: 'BCD', amount: 400 }, { item: 'Dive computer', amount: 250 }],
      room: { label: 'Deluxe', amount: 1000 },
      addons: [{ label: 'Camera', amount: 300 }],
      transport: 1300,
      nitroxCourse: NITROX_COURSE_FEE,
      surcharge: { label: 'Card/PayPal surcharge (5%)', amount: 600 },
    })
    expect(lines.map(l => l.kind)).toEqual([
      'base', 'gear', 'gear', 'room', 'addon', 'transport', 'nitrox_course', 'surcharge',
    ])
    expect(chargesTotal(lines)).toBe(2800 + 400 + 250 + 1000 + 300 + 1300 + 6000 + 600)
  })

  it('suffixes gear labels with the day count only when > 1 day', () => {
    expect(buildCharges({ base: 0, gear: [{ item: 'BCD', amount: 800 }], gearDays: 2 })[1].label)
      .toBe('Gear: BCD (x2 days)')
    expect(buildCharges({ base: 0, gear: [{ item: 'BCD', amount: 400 }], gearDays: 1 })[1].label)
      .toBe('Gear: BCD')
  })

  it('skips a zero-amount gear/room/add-on/transport line', () => {
    const lines = buildCharges({
      base: 100,
      gear: [{ item: 'Mask', amount: 0 }],
      room: { label: 'Std', amount: 0 },
      addons: [{ label: 'Free', amount: 0 }],
      transport: 0,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0].kind).toBe('base')
  })
})

describe('resolveCharges', () => {
  const event = { price: 2800, transport_price: 1300, dive_days: 2, deposit_amount: 1000 } as AppEvent

  it('returns the stored snapshot verbatim when present', () => {
    const snapshot = [{ kind: 'base' as const, label: 'Base', amount: 999 }]
    const details: BookingDetails = { charges: snapshot, total: 999 }
    expect(resolveCharges({ details, event })).toBe(snapshot)
  })

  it('recomputes lines from selections + current prices when no snapshot', () => {
    const details: BookingDetails = {
      gear: { rent: true, items: ['BCD', 'Dive computer'] },
      room: { option_id: 'r1' },
      add_ons: ['a1'],
      transportation: true,
      nitrox_course_addon: true,
      payment_method: 'bank_transfer',
    }
    const lines = resolveCharges({
      details,
      event,
      roomPrices: new Map([['r1', { label: 'Deluxe', amount: 1500 }]]),
      addonPrices: new Map([['a1', { label: 'Camera', amount: 300 }]]),
    })
    // base + (BCD 400 + DiveComputer 250) x2 days + room 1500 + addon 300 + transport 1300 + nitrox 6000
    expect(chargesTotal(lines)).toBe(2800 + (400 + 250) * 2 + 1500 + 300 + 1300 + NITROX_COURSE_FEE)
    expect(lines.find(l => l.kind === 'gear')?.label).toBe('Gear: BCD (x2 days)')
  })

  it("recomputes the method's own surcharge on the full subtotal", () => {
    const details: BookingDetails = { payment_method: 'credit_card' }
    const lines = resolveCharges({
      details,
      event: { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 500 } as AppEvent,
      paymentMethods: METHODS,
    })
    expect(lines.find(l => l.kind === 'surcharge')).toEqual({
      kind: 'surcharge', label: t.chargeLines.surcharge('Credit card', 5, false), amount: 50,
    })
  })

  it('charges the surcharge on the deposit only when paying deposit-only', () => {
    const details: BookingDetails = { payment_method: 'credit_card', pay_deposit_only: true }
    const lines = resolveCharges({
      details,
      event: { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 500 } as AppEvent,
      paymentMethods: METHODS,
    })
    expect(lines.find(l => l.kind === 'surcharge')).toEqual({
      kind: 'surcharge', label: t.chargeLines.surcharge('Credit card', 5, true), amount: 25,
    })
  })

  // A method the shop has since deleted must not inherit another method's rate.
  it('adds no surcharge line for a payment method that no longer resolves', () => {
    const details: BookingDetails = { payment_method: 'crypto' }
    const lines = resolveCharges({
      details,
      event: { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 0 } as AppEvent,
      paymentMethods: METHODS,
    })
    expect(lines.some(l => l.kind === 'surcharge')).toBe(false)
  })

  it('falls back to the raw id label when a room/add-on price is unknown', () => {
    const details: BookingDetails = { room: { option_id: 'missing' }, add_ons: ['gone'], payment_method: 'cash' }
    const lines = resolveCharges({ details, event: { price: 0, transport_price: 0, dive_days: 1, deposit_amount: 0 } as AppEvent })
    // unknown prices resolve to amount 0, so they're dropped from the breakdown
    expect(lines.map(l => l.kind)).toEqual(['base'])
  })

  it('reconciles a legacy recompute to the recorded total with an adjustment line', () => {
    // A legacy full-set package was cheaper than today's à-la-carte gear, so the
    // recorded total (8,150) is below base 7,200 + the current gear sum. Derive
    // the gear sum from the live prices so this stays correct as prices change.
    const items = [...FULL_GEAR_SET]
    const gearSum = items.reduce((s, i) => s + GEAR_ALACARTE_PRICES[i], 0)
    const recompute = 7200 + gearSum
    const details: BookingDetails = {
      gear: { rent: true, items },
      payment_method: 'bank_transfer',
      total: 8150,
    }
    const lines = resolveCharges({
      details,
      event: { price: 7200, transport_price: 0, dive_days: 1, deposit_amount: 0 } as AppEvent,
    })
    const adj = lines.find(l => l.kind === 'adjustment')
    expect(adj?.amount).toBe(8150 - recompute)
    expect(adj?.label).toMatch(/legacy/i)
    // The reconciled breakdown ties out to the recorded total.
    expect(chargesTotal(lines)).toBe(8150)
  })

  it('adds no adjustment when the recompute already matches the recorded total', () => {
    const details: BookingDetails = { gear: { rent: false }, payment_method: 'cash', total: 1000 }
    const lines = resolveCharges({ details, event: { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 0 } as AppEvent })
    expect(lines.some(l => l.kind === 'adjustment')).toBe(false)
  })

  it('returns [] when details or event is missing', () => {
    expect(resolveCharges({ details: null, event })).toEqual([])
    expect(resolveCharges({ details: { payment_method: 'cash' }, event: null })).toEqual([])
  })
})

// The server recompute in create-registration (supabase/functions/_shared/
// booking-charges.ts) must reach the same total the browser previews, or an
// honest booking's authoritative total would drift from what the diver saw.
// This parity block pins the two implementations together.
describe('computeBookingMoney parity with client resolveCharges', () => {
  const gearPrices = GEAR_ALACARTE_PRICES
  const nitroxCourseFee = siteConfig.business.nitroxCourseFee

  it('matches a fully-loaded bank-transfer booking (no surcharge)', () => {
    const event = { price: 2800, transport_price: 1300, dive_days: 2, deposit_amount: 1000 } as AppEvent
    const details: BookingDetails = {
      gear: { rent: true, items: ['BCD', 'Dive computer'] },
      room: { option_id: 'r1' },
      add_ons: ['a1'],
      transportation: true,
      nitrox_course_addon: true,
      payment_method: 'bank_transfer',
    }
    const clientTotal = chargesTotal(resolveCharges({
      details, event,
      roomPrices: new Map([['r1', { label: 'Deluxe', amount: 1500 }]]),
      addonPrices: new Map([['a1', { label: 'Camera', amount: 300 }]]),
    }))
    const money = computeBookingMoney({
      base: 2800, diveDays: 2, depositAmount: 1000, transportPrice: 1300,
      gearItems: ['BCD', 'Dive computer'], gearPrices,
      roomAddedPrice: 1500, addonsTotal: 300,
      needsTransport: true, nitroxCourse: true, nitroxCourseFee, surchargeRate: 0,
      payDepositOnly: false,
    })
    expect(money.total).toBe(clientTotal)
    expect(money.deposit).toBe(1000) // face 1000, no surcharge
  })

  it('matches a full card payment (5% on the whole subtotal)', () => {
    const event = { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 500 } as AppEvent
    const details: BookingDetails = { payment_method: 'credit_card' }
    const clientTotal = chargesTotal(resolveCharges({ details, event, paymentMethods: METHODS }))
    const money = computeBookingMoney({
      base: 1000, diveDays: 1, depositAmount: 500, transportPrice: 0,
      gearItems: [], gearPrices, roomAddedPrice: 0, addonsTotal: 0,
      needsTransport: false, nitroxCourse: false, nitroxCourseFee, surchargeRate: surchargeRateFor(CARD),
      payDepositOnly: false,
    })
    expect(money.total).toBe(clientTotal) // 1000 + 50
    expect(money.deposit).toBe(525)       // face 500 + 5% (25)
  })

  it('matches a deposit-only card payment (surcharge on the deposit only)', () => {
    const event = { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 500 } as AppEvent
    const details: BookingDetails = { payment_method: 'credit_card', pay_deposit_only: true }
    const clientTotal = chargesTotal(resolveCharges({ details, event, paymentMethods: METHODS }))
    const money = computeBookingMoney({
      base: 1000, diveDays: 1, depositAmount: 500, transportPrice: 0,
      gearItems: [], gearPrices, roomAddedPrice: 0, addonsTotal: 0,
      needsTransport: false, nitroxCourse: false, nitroxCourseFee, surchargeRate: surchargeRateFor(CARD),
      payDepositOnly: true,
    })
    expect(money.total).toBe(clientTotal) // 1000 + 25
    expect(money.deposit).toBe(525)       // face 500 + 5% (25)
  })

  it('returns a null deposit when the event has none', () => {
    const money = computeBookingMoney({
      base: 3200, diveDays: 1, depositAmount: 0, transportPrice: 0,
      gearItems: [], gearPrices, roomAddedPrice: 0, addonsTotal: 0,
      needsTransport: false, nitroxCourse: false, nitroxCourseFee, surchargeRate: 0,
      payDepositOnly: false,
    })
    expect(money.total).toBe(3200)
    expect(money.deposit).toBeNull()
  })
})

// The rate ACTUALLY CHARGED must be the one the diver was shown. It used to be
// a single shop-wide config percent applied to a hardcoded card/PayPal pair;
// every method now carries its own, so a shop can charge 3% on cards and
// nothing on a transfer without either figure being a literal in the code.
describe('surcharge comes from the chosen method', () => {
  it('reads the rate off the method, not a shop-wide constant', () => {
    expect(surchargeRateFor(method({ key: 'k', label: 'L', surcharge_percent: 3 }))).toBe(0.03)
    expect(surchargeRateFor(CASH)).toBe(0)
    expect(surchargeRateFor(null)).toBe(0)
    expect(surchargeRateFor(undefined)).toBe(0)
  })

  it('labels the line with the method the diver picked', () => {
    const line = surchargeLine(method({ key: 'ppl', label: 'PayPal', surcharge_percent: 3 }), 2000, false)
    expect(line).toEqual({ label: t.chargeLines.surcharge('PayPal', 3, false), amount: 60 })
  })

  it('emits no line for a method that carries no surcharge', () => {
    expect(surchargeLine(CASH, 2000, false)).toBeNull()
    expect(surchargeLine(null, 2000, false)).toBeNull()
  })

  it('the server-side money math bills the rate it is handed', () => {
    const at = (rate: number) => computeBookingMoney({
      base: 2000, diveDays: 1, depositAmount: 0, transportPrice: 0,
      gearItems: [], gearPrices: GEAR_ALACARTE_PRICES, roomAddedPrice: 0, addonsTotal: 0,
      needsTransport: false, nitroxCourse: false,
      nitroxCourseFee: siteConfig.business.nitroxCourseFee,
      surchargeRate: rate, payDepositOnly: false,
    }).total
    expect(at(0.03)).toBe(2060)
    expect(at(0.05)).toBe(2100)
  })
})

// The surcharge percentage must be interpolated from the method, never baked
// into a catalog string — a shop on 3% showing "+5%" is a lie on the PDF.
describe('surcharge label interpolates the rate it is given', () => {
  it('carries the percent through and distinguishes the deposit-only variant', () => {
    expect(t.chargeLines.surcharge('Credit card', 7, false)).toContain('7%')
    expect(t.chargeLines.surcharge('Credit card', 7, true)).toContain('7%')
    expect(t.chargeLines.surcharge('Credit card', 7, true))
      .not.toBe(t.chargeLines.surcharge('Credit card', 7, false))
  })

  it('no catalog string bakes a surcharge percentage in', () => {
    for (const line of [
      t.chargeLines.surcharge('Credit card', 7, false),
      t.chargeLines.surcharge('Credit card', 7, true),
    ]) {
      expect(line).toContain('7%')
      expect(line).not.toMatch(/\b5%/)
    }
  })
})
