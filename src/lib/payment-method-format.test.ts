import { describe, it, expect } from 'vitest'
import {
  surchargeRateFor,
  paymentMethodLabel,
  hasTransferDetails,
  type PaymentMethodDetails,
} from './payment-method-format'

// The renderer itself is exercised end-to-end through payment-instructions.test.ts
// (which binds it to the real catalog and shop config). These cover the pure
// predicates the register form and the admin list branch on.

function method(over: Partial<PaymentMethodDetails> = {}): PaymentMethodDetails {
  return {
    key: 'k', label: 'Method', surcharge_percent: 0,
    collects_invoice_email: false, shows_shop_contact: false,
    ...over,
  }
}

describe('surchargeRateFor', () => {
  it('converts the stored percent to a multiplier', () => {
    expect(surchargeRateFor(method({ surcharge_percent: 5 }))).toBe(0.05)
    expect(surchargeRateFor(method({ surcharge_percent: 2.5 }))).toBe(0.025)
  })

  it('treats a missing, zero, negative or non-numeric percent as no surcharge', () => {
    expect(surchargeRateFor(null)).toBe(0)
    expect(surchargeRateFor(undefined)).toBe(0)
    expect(surchargeRateFor(method({ surcharge_percent: 0 }))).toBe(0)
    expect(surchargeRateFor(method({ surcharge_percent: -5 }))).toBe(0)
    expect(surchargeRateFor(method({ surcharge_percent: Number.NaN }))).toBe(0)
  })

  // Postgres numeric comes back as a string through some clients; a string rate
  // silently multiplying to NaN would zero out a real surcharge.
  it('accepts a numeric column that arrives as a string', () => {
    expect(surchargeRateFor({ surcharge_percent: '5' } as unknown as PaymentMethodDetails)).toBe(0.05)
  })
})

describe('paymentMethodLabel', () => {
  it('leaves a surcharge-free name alone', () => {
    expect(paymentMethodLabel(method({ label: 'Cash' }))).toBe('Cash')
  })

  it('suffixes the surcharge the shop set for that method', () => {
    expect(paymentMethodLabel(method({ label: 'Credit card', surcharge_percent: 3 })))
      .toBe('Credit card (+3%)')
  })
})

describe('hasTransferDetails', () => {
  it('is false until the shop publishes something payable', () => {
    expect(hasTransferDetails(method())).toBe(false)
    expect(hasTransferDetails(method({ notes: 'Put your name in the memo.' }))).toBe(false)
    expect(hasTransferDetails(method({ account_number: '  ' }))).toBe(false)
  })

  it('is true for any published account field or payment link', () => {
    expect(hasTransferDetails(method({ account_number: '1234' }))).toBe(true)
    expect(hasTransferDetails(method({ bank_name: 'CTBC' }))).toBe(true)
    expect(hasTransferDetails(method({ swift_bic: 'CTCBTWTP' }))).toBe(true)
    expect(hasTransferDetails(method({ pay_url: 'https://paypal.me/x' }))).toBe(true)
  })
})
