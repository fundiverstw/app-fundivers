import { describe, it, expect } from 'vitest'
import { buildCharges, chargesTotal, resolveCharges, NITROX_COURSE_FEE } from './booking-charges'
import { GEAR_ALACARTE_PRICES } from './gear'
import type { AppEvent, BookingDetails } from '../types/database'
import { siteConfig } from '../config/site'
import { t } from '../i18n'

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

  it('recomputes the 5% card surcharge on the full subtotal', () => {
    const details: BookingDetails = { payment_method: 'credit_card' }
    const lines = resolveCharges({ details, event: { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 500 } as AppEvent })
    expect(lines.find(l => l.kind === 'surcharge')).toEqual({
      kind: 'surcharge', label: 'Card/PayPal surcharge (5%)', amount: 50,
    })
  })

  it('charges the card surcharge on the deposit only when paying deposit-only', () => {
    const details: BookingDetails = { payment_method: 'credit_card', pay_deposit_only: true }
    const lines = resolveCharges({ details, event: { price: 1000, transport_price: 0, dive_days: 1, deposit_amount: 500 } as AppEvent })
    expect(lines.find(l => l.kind === 'surcharge')).toEqual({
      kind: 'surcharge', label: 'Card/PayPal surcharge (5% of deposit)', amount: 25,
    })
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
    const items = ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots', 'Dive computer']
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

// The card surcharge rate lives in business.cardSurchargePercent. It was
// hardcoded as "5%" in four separate places (this module, pdf.ts, and two
// catalog keys), so a fork on a different rate silently showed divers, and
// printed on their PDF, a percentage the shop does not charge.
describe('card surcharge label tracks the configured rate', () => {
  it('interpolates the config percent, not a literal 5', () => {
    const pct = siteConfig.business.cardSurchargePercent
    expect(t.chargeLines.surcharge(pct, false)).toContain(`${pct}%`)
    expect(t.chargeLines.surcharge(pct, true)).toContain(`${pct}%`)
    // Distinguishable: the deposit-only variant says so.
    expect(t.chargeLines.surcharge(pct, true)).not.toBe(t.chargeLines.surcharge(pct, false))
  })

  it('no catalog string bakes a surcharge percentage in', () => {
    const suspects = [
      t.chargeLines.surcharge(7, false),
      t.chargeLines.surcharge(7, true),
      t.register.payment.methodPaypal(7),
      t.register.payment.methodCreditCard(7),
    ]
    for (const s of suspects) {
      expect(s).toContain('7%')
      expect(s).not.toMatch(/\b5%/)
    }
  })
})
