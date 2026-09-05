import { describe, it, expect } from 'vitest'
import {
  paymentInstructionsFor,
  paymentConfirmationReminder,
} from './payment-instructions'
import type { PaymentMethodDetails } from './payment-method-format'
import { siteConfig } from '../config/site'
import { t } from '../i18n'

// Copy assertions go through the catalog: these blocks render in whatever
// shop-facing language the deployment picked, so pinning English prose here
// would test the language rather than the behavior. What stays hardcoded is
// what must be true in EVERY language — the shop's own values appear, the
// invoice address is echoed verbatim, and an unconfigured method says so
// instead of showing a diver an empty account.
const p = t.paymentInstructions

function method(over: Partial<PaymentMethodDetails> = {}): PaymentMethodDetails {
  return {
    key: 'bank_transfer',
    label: 'Domestic bank transfer',
    surcharge_percent: 0,
    collects_invoice_email: false,
    shows_shop_contact: false,
    ...over,
  }
}

describe('paymentInstructionsFor', () => {
  it('titles the block with the shop-authored name, no surcharge suffix when there is none', () => {
    expect(paymentInstructionsFor(method()).title).toBe(p.howToPay('Domestic bank transfer'))
  })

  it('suffixes the method name with its own surcharge, not a shop-wide one', () => {
    const i = paymentInstructionsFor(method({ label: 'Credit card', surcharge_percent: 3 }))
    expect(i.title).toBe(p.howToPay('Credit card (+3%)'))
  })

  it('prints the shop bank details it was given', () => {
    const i = paymentInstructionsFor(method({
      bank_name: 'CTBC Bank',
      bank_branch: 'Yonghe',
      bank_code: '822',
      account_number: '1234-5678-9012',
      account_holder: 'FunDivers TW',
      swift_bic: 'CTCBTWTP',
    }))
    expect(i.lines).toContain(p.bankName('CTBC Bank'))
    expect(i.lines).toContain(p.bankBranch('Yonghe'))
    expect(i.lines).toContain(p.bankCode('822'))
    expect(i.lines).toContain(p.accountNumber('1234-5678-9012'))
    expect(i.lines).toContain(p.accountHolder('FunDivers TW'))
    expect(i.lines).toContain(p.swift('CTCBTWTP'))
  })

  it('omits every blank transfer row rather than printing an empty label', () => {
    const i = paymentInstructionsFor(method({
      account_number: '1234',
      bank_name: '   ',
      swift_bic: null,
    }))
    expect(i.lines).toContain(p.accountNumber('1234'))
    expect(i.lines.some(l => l === p.bankName('') || l === p.bankName('   '))).toBe(false)
    expect(i.lines.some(l => l.startsWith(p.swift('')))).toBe(false)
  })

  it('says details are coming when the shop has published none — never a bare memo instruction', () => {
    const i = paymentInstructionsFor(method({ notes: 'Put your name in the memo.' }))
    expect(i.lines).toContain('Put your name in the memo.')
    expect(i.lines).toContain(p.bankDetailsPending)
  })

  it('drops the pending line as soon as anything payable is published', () => {
    const i = paymentInstructionsFor(method({ account_number: '1234-5678' }))
    expect(i.lines).not.toContain(p.bankDetailsPending)
  })

  it('renders each notes line separately, skipping blank lines', () => {
    const i = paymentInstructionsFor(method({
      account_number: '1',
      notes: 'First line.\n\n  Second line.  ',
    }))
    expect(i.lines).toContain('First line.')
    expect(i.lines).toContain('Second line.')
    expect(i.lines).not.toContain('')
  })

  it('links an online payment URL', () => {
    const i = paymentInstructionsFor(method({ pay_url: 'https://paypal.me/example' }))
    expect(i.lines).toContain(p.payOnline('https://paypal.me/example'))
  })

  // The shop's own details are passed in — they are a row an admin edits, not
  // a config literal — so a caller that has them prints them.
  it('appends the shop contact the caller supplies when the method is paid in person', () => {
    const shop = { phone: '+886 900-000-000', address: '1 Test St', mapsUrl: 'https://maps.example/x' }
    const i = paymentInstructionsFor(
      method({ key: 'cash', label: 'Cash', shows_shop_contact: true }), { shop },
    )
    const body = i.lines.join(' ')
    expect(body).toContain(shop.phone)
    expect(body).toContain(shop.address)
    expect(body).toContain(shop.mapsUrl)
    // Paying at the counter needs no bank account, so it must not nag for one.
    expect(i.lines).not.toContain(p.bankDetailsPending)
  })

  // A shop that has published none of its details prints none of them, rather
  // than a labelled empty line where the address should be.
  it('prints no contact lines at all when the shop has published none', () => {
    const i = paymentInstructionsFor(method({ key: 'cash', label: 'Cash', shows_shop_contact: true }))
    expect(i.lines.join(' ')).not.toContain(p.address(''))
    expect(i.lines).toHaveLength(0)
  })

  it('falls back to the registered-email wording with no invoice email', () => {
    const i = paymentInstructionsFor(method({ collects_invoice_email: true }))
    expect(i.lines.join(' ')).toContain(p.invoiceTo(p.registeredEmail))
  })

  it('shows a supplied invoice email verbatim', () => {
    const i = paymentInstructionsFor(
      method({ collects_invoice_email: true }), { invoiceEmail: 'invoices@example.com' })
    const body = i.lines.join(' ')
    expect(body).toContain(p.invoiceTo('invoices@example.com'))
    expect(body).not.toContain(p.registeredEmail)
  })

  it('falls back to registered email on a whitespace-only invoice email', () => {
    const i = paymentInstructionsFor(
      method({ collects_invoice_email: true }), { invoiceEmail: '   ' })
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
