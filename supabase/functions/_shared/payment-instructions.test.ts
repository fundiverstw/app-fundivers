import { describe, it, expect } from 'vitest'
import {
  paymentInstructionsFor as edgeInstructions,
  paymentConfirmationReminder as edgeReminder,
} from './payment-instructions.ts'
import {
  paymentInstructionsFor as spaInstructions,
  paymentConfirmationReminder as spaReminder,
  type PaymentMethod,
} from '../../../src/lib/payment-instructions'

// The edge function and the SPA render the same "How to pay" copy — one into the
// emailed PDF, one into the registration form. They used to be two hand-kept
// copies of the same prose, with a comment asking future editors to mirror any
// change. Both now read one catalog, so this pins that they cannot drift.
//
// The edge side used to be pinned to English because pdf.ts rendered with jsPDF's
// WinAnsi helvetica, which mangles CJK. pdf.ts now embeds a CJK face
// (see pdf-fonts.ts), so both sides follow the deployment's language.

const METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'paypal', 'credit_card']

describe('edge / SPA payment-instruction parity', () => {
  it.each(METHODS)('%s renders identically on both sides', method => {
    expect(edgeInstructions(method)).toEqual(spaInstructions(method))
  })

  it('passes the invoice email through identically', () => {
    const opts = { invoiceEmail: 'invoices@example.com' }
    expect(edgeInstructions('credit_card', opts)).toEqual(spaInstructions('credit_card', opts))
  })

  it('never embeds raw bank account details', () => {
    expect(edgeInstructions('bank_transfer')!.lines.join(' ')).not.toMatch(/code:|account:|branch:/i)
  })

  it('returns null for a payment method the SPA never emits', () => {
    expect(edgeInstructions('crypto')).toBeNull()
  })

  it('renders the same after-you-pay reminder', () => {
    expect(edgeReminder()).toEqual(spaReminder())
  })
})
