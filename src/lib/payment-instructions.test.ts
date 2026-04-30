import { describe, it, expect } from 'vitest'
import { paymentInstructionsFor, SHOP_ADDRESS, SHOP_PHONE } from './payment-instructions'

describe('paymentInstructionsFor', () => {
  it('cash → in-person at the shop, including address + phone', () => {
    const i = paymentInstructionsFor('cash')
    expect(i.title).toMatch(/cash/i)
    expect(i.lines.join(' ')).toContain(SHOP_PHONE)
    expect(i.lines.join(' ')).toContain(SHOP_ADDRESS)
    expect(i.lines.join(' ').toLowerCase()).toContain('in person')
  })

  it('bank_transfer → bank account placeholders', () => {
    const i = paymentInstructionsFor('bank_transfer')
    expect(i.title).toMatch(/bank transfer/i)
    const body = i.lines.join(' ')
    expect(body).toMatch(/account name/i)
    expect(body).toMatch(/bank/i)
    expect(body).toMatch(/account number/i)
  })

  it('credit_card → routes through PayPal email link', () => {
    const i = paymentInstructionsFor('credit_card')
    expect(i.title).toMatch(/paypal/i)
    expect(i.lines.join(' ').toLowerCase()).toContain('paypal payment link')
    expect(i.lines.join(' ').toLowerCase()).toContain('email')
  })
})
