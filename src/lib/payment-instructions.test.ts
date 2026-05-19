import { describe, it, expect } from 'vitest'
import {
  paymentInstructionsFor,
  paymentConfirmationReminder,
  SHOP_ADDRESS,
  SHOP_PHONE,
  SHOP_MAPS_URL,
  PAYPAL_LINK,
} from './payment-instructions'

describe('paymentInstructionsFor', () => {
  it('cash → in-person at the shop, including address + phone + map link', () => {
    const i = paymentInstructionsFor('cash')
    expect(i.title).toMatch(/cash/i)
    const body = i.lines.join(' ')
    expect(body).toContain(SHOP_PHONE)
    expect(body).toContain(SHOP_ADDRESS)
    expect(body).toContain(SHOP_MAPS_URL)
    expect(body.toLowerCase()).toContain('in person')
  })

  it('bank_transfer → local bank details (code, account, name, branch)', () => {
    const i = paymentInstructionsFor('bank_transfer')
    expect(i.title).toMatch(/bank transfer/i)
    const body = i.lines.join(' ')
    expect(body).toMatch(/code/i)
    expect(body).toMatch(/account/i)
    expect(body).toMatch(/name/i)
    expect(body).toMatch(/branch/i)
  })

  it('paypal → paypal.me link + name-in-note instruction', () => {
    const i = paymentInstructionsFor('paypal')
    expect(i.title).toMatch(/paypal/i)
    const body = i.lines.join(' ')
    expect(body).toContain(PAYPAL_LINK)
    expect(body.toLowerCase()).toContain('full name')
  })

  it('credit_card with no invoice email → falls back to "your registered email"', () => {
    const i = paymentInstructionsFor('credit_card')
    expect(i.title).toMatch(/credit card/i)
    const body = i.lines.join(' ')
    expect(body.toLowerCase()).toContain('invoice')
    expect(body.toLowerCase()).toContain('registered email')
  })

  it('credit_card with invoice email → shows that address verbatim', () => {
    const i = paymentInstructionsFor('credit_card', { invoiceEmail: 'invoices@example.com' })
    const body = i.lines.join(' ')
    expect(body).toContain('invoices@example.com')
    expect(body.toLowerCase()).not.toContain('registered email')
  })

  it('credit_card whitespace-only invoice email → falls back to registered email', () => {
    const i = paymentInstructionsFor('credit_card', { invoiceEmail: '   ' })
    expect(i.lines.join(' ').toLowerCase()).toContain('registered email')
  })
})

describe('paymentConfirmationReminder', () => {
  it('names the three contact channels and points at the app for updates', () => {
    const r = paymentConfirmationReminder()
    expect(r.title.toLowerCase()).toContain('after you pay')
    const body = r.lines.join(' ').toLowerCase()
    expect(body).toContain('email')
    expect(body).toContain('line')
    expect(body).toContain('whatsapp')
    expect(body).toMatch(/confirm receipt|let us know/)
    expect(body).toContain('fundivers tw app')
  })
})
