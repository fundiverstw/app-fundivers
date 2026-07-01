// Per-method "How to pay" copy shown on the registration form's step 4 and
// embedded in the emailed PDF. Shop values come from fundive.config.ts. The
// edge function keeps a parallel copy of the *logic* under
// supabase/functions/_shared/payment-instructions.ts — it reads the same config,
// so the shop values never drift; mirror any COPY changes there too.

import { siteConfig } from '../config/site'

export const SHOP_PHONE    = siteConfig.contact.phone
export const SHOP_ADDRESS  = siteConfig.contact.address
export const SHOP_MAPS_URL = siteConfig.contact.mapsUrl

export const PAYPAL_LINK = siteConfig.contact.paypalLink

const CARD_SURCHARGE = `+${siteConfig.business.cardSurchargePercent}%`

export type PaymentMethod = 'bank_transfer' | 'credit_card' | 'paypal' | 'cash'

export interface PaymentInstructions {
  title: string
  lines: string[]
}

/**
 * Build the per-method instruction block. `invoiceEmail` only applies to
 * credit_card — when set, the block tells the diver where the card-payment
 * invoice will land; otherwise it falls back to "your registered email".
 */
export function paymentInstructionsFor(
  method: PaymentMethod,
  opts: { invoiceEmail?: string | null } = {},
): PaymentInstructions {
  switch (method) {
    case 'cash':
      return {
        title: 'How to pay — Cash',
        lines: [
          'Bring your payment to the shop in person.',
          `Phone: ${SHOP_PHONE}`,
          `Address: ${SHOP_ADDRESS}`,
          `Map: ${SHOP_MAPS_URL}`,
        ],
      }
    case 'bank_transfer':
      return {
        title: 'How to pay — Local bank transfer',
        lines: [
          "We'll email you our bank transfer details shortly so you can complete your payment.",
        ],
      }
    case 'paypal':
      return {
        title: `How to pay — PayPal (${CARD_SURCHARGE})`,
        lines: [
          'Send your payment via PayPal:',
          PAYPAL_LINK,
          'Include your full name in the payment note so we can match it to your booking.',
        ],
      }
    case 'credit_card': {
      const target = (opts.invoiceEmail && opts.invoiceEmail.trim()) || 'your registered email'
      return {
        title: `How to pay — Credit card (${CARD_SURCHARGE})`,
        lines: [
          "We'll email you an invoice with a credit-card payment link.",
          `Invoice will be sent to: ${target}`,
        ],
      }
    }
  }
}

/**
 * Shared "after you pay" reminder. We don't see bank/PayPal/cash payments
 * in real time — without a heads-up from the diver we may not know to look
 * for it, and a missed confirmation has cost real bookings. Surfaced
 * verbatim on the form and PDF for every method.
 */
export function paymentConfirmationReminder(): PaymentInstructions {
  return {
    title: 'After you pay',
    lines: [
      `Once you send your payment, please contact ${siteConfig.identity.shortName} by email, LINE, or WhatsApp so we can confirm receipt.`,
      `Keep an eye on the ${siteConfig.identity.shopName} app for updates to your registration status, payment confirmations, and event reminders.`,
    ],
  }
}
