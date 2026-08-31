import { describe, it, expect } from 'vitest'
import {
  paymentInstructionsFor as edgeInstructions,
  paymentConfirmationReminder as edgeReminder,
} from './payment-instructions.ts'
import {
  paymentInstructionsFor as spaInstructions,
  paymentConfirmationReminder as spaReminder,
} from '../../../src/lib/payment-instructions'
import type { PaymentMethodDetails } from '../../../src/lib/payment-method-format'

// The edge function and the SPA render the same "How to pay" block — one into
// the emailed PDF, one into the registration form. They used to be two
// hand-kept copies of the same prose. Both now bind one renderer to one
// catalog and one config, so this pins that they cannot drift.
//
// The edge side used to be pinned to English because pdf.ts rendered with jsPDF's
// WinAnsi helvetica, which mangles CJK. pdf.ts now embeds a CJK face
// (see pdf-fonts.ts), so both sides follow the deployment's language.

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

const METHODS: PaymentMethodDetails[] = [
  method({ key: 'cash', label: 'Cash', shows_shop_contact: true, notes: 'Pay at the counter.' }),
  method({ account_number: '1234-5678', bank_name: 'CTBC', account_holder: 'The Shop' }),
  method({ key: 'paypal', label: 'PayPal', surcharge_percent: 5, pay_url: 'https://paypal.me/example' }),
  method({ key: 'credit_card', label: 'Credit card', surcharge_percent: 5, collects_invoice_email: true }),
]

describe('edge / SPA payment-instruction parity', () => {
  it.each(METHODS)('$key renders identically on both sides', m => {
    expect(edgeInstructions(m)).toEqual(spaInstructions(m))
  })

  it('passes the invoice email through identically', () => {
    const card = METHODS[3]
    const opts = { invoiceEmail: 'invoices@example.com' }
    expect(edgeInstructions(card, opts)).toEqual(spaInstructions(card, opts))
  })

  it('prints the shop-authored account details on the PDF side', () => {
    const body = edgeInstructions(METHODS[1])!.lines.join(' ')
    expect(body).toContain('1234-5678')
    expect(body).toContain('CTBC')
  })

  // A booking made under a method the shop has since deleted resolves to no
  // row. The PDF must omit the block rather than invent one.
  it('returns null when the booking names no resolvable method', () => {
    expect(edgeInstructions(null)).toBeNull()
    expect(edgeInstructions(undefined)).toBeNull()
  })

  it('renders the same after-you-pay reminder', () => {
    expect(edgeReminder()).toEqual(spaReminder())
  })
})
