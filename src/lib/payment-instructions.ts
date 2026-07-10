// Per-method "How to pay" copy shown on the registration form's step 4 and
// embedded in the emailed PDF. Shop values come from fundive.config.ts; the copy
// comes from the message catalog. The edge function keeps a parallel copy of the
// *logic* under supabase/functions/_shared/payment-instructions.ts — both read
// the same config and the same catalog, so neither the shop values nor the copy
// can drift.

import { siteConfig } from '../config/site'
import { t } from '../i18n'

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
  const p = t.paymentInstructions
  switch (method) {
    case 'cash':
      return {
        title: p.cashTitle,
        lines: [
          p.cashLine,
          p.phone(SHOP_PHONE),
          p.address(SHOP_ADDRESS),
          p.map(SHOP_MAPS_URL),
        ],
      }
    case 'bank_transfer':
      return {
        title: p.bankTitle,
        lines: [p.bankLine],
      }
    case 'paypal':
      return {
        title: p.paypalTitle(CARD_SURCHARGE),
        lines: [
          p.paypalLine,
          PAYPAL_LINK,
          p.paypalNote,
        ],
      }
    case 'credit_card': {
      const target = (opts.invoiceEmail && opts.invoiceEmail.trim()) || p.registeredEmail
      return {
        title: p.cardTitle(CARD_SURCHARGE),
        lines: [
          p.cardLine,
          p.invoiceTo(target),
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
  const p = t.paymentInstructions
  return {
    title: p.afterTitle,
    lines: [
      p.afterContact(siteConfig.identity.shortName),
      p.afterApp(siteConfig.identity.shopName),
    ],
  }
}
