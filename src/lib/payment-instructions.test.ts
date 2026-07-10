import { describe, it, expect } from 'vitest'
import {
  paymentInstructionsFor,
  paymentConfirmationReminder,
  SHOP_ADDRESS,
  SHOP_PHONE,
  SHOP_MAPS_URL,
  PAYPAL_LINK,
} from './payment-instructions'
import { siteConfig } from '../config/site'
import { t } from '../i18n'

// Copy assertions go through the catalog: these blocks render in whatever
// shop-facing language the deployment picked, so pinning English prose here
// would test the language rather than the behaviour. What stays hardcoded is
// what must be true in EVERY language — the shop's config values appear, the
// invoice address is echoed verbatim, and no raw bank details leak.
const p = t.paymentInstructions

describe('paymentInstructionsFor', () => {
  it('cash → in-person at the shop, including address + phone + map link', () => {
    const i = paymentInstructionsFor('cash')
    expect(i.title).toBe(p.cashTitle)
    const body = i.lines.join(' ')
    expect(body).toContain(SHOP_PHONE)
    expect(body).toContain(SHOP_ADDRESS)
    expect(body).toContain(SHOP_MAPS_URL)
    expect(body).toContain(p.cashLine)
  })

  it('bank_transfer → tells the diver the bank details arrive by email (no raw account details)', () => {
    const i = paymentInstructionsFor('bank_transfer')
    expect(i.title).toBe(p.bankTitle)
    expect(i.lines).toEqual([p.bankLine])
    // The real account number/name/branch must not be embedded, in any language.
    expect(i.lines.join(' ')).not.toMatch(/code:|account:|branch:/i)
  })

  it('paypal → paypal.me link + name-in-note instruction', () => {
    const i = paymentInstructionsFor('paypal')
    expect(i.title).toBe(p.paypalTitle(`+${siteConfig.business.cardSurchargePercent}%`))
    const body = i.lines.join(' ')
    expect(body).toContain(PAYPAL_LINK)
    expect(body).toContain(p.paypalNote)
  })

  it('credit_card with no invoice email → falls back to the registered-email wording', () => {
    const i = paymentInstructionsFor('credit_card')
    expect(i.title).toBe(p.cardTitle(`+${siteConfig.business.cardSurchargePercent}%`))
    expect(i.lines.join(' ')).toContain(p.invoiceTo(p.registeredEmail))
  })

  it('credit_card with invoice email → shows that address verbatim', () => {
    const i = paymentInstructionsFor('credit_card', { invoiceEmail: 'invoices@example.com' })
    const body = i.lines.join(' ')
    expect(body).toContain(p.invoiceTo('invoices@example.com'))
    expect(body).not.toContain(p.registeredEmail)
  })

  it('credit_card whitespace-only invoice email → falls back to registered email', () => {
    const i = paymentInstructionsFor('credit_card', { invoiceEmail: '   ' })
    expect(i.lines.join(' ')).toContain(p.invoiceTo(p.registeredEmail))
  })
})

describe('paymentConfirmationReminder', () => {
  it('names the contact channels and points at the shop app for updates', () => {
    const r = paymentConfirmationReminder()
    expect(r.title).toBe(p.afterTitle)
    expect(r.lines).toEqual([
      p.afterContact(siteConfig.identity.shortName),
      p.afterApp(siteConfig.identity.shopName),
    ])
    // The channel names and the app name survive interpolation in every locale.
    expect(r.lines.join(' ')).toContain(siteConfig.identity.shopName)
  })
})
