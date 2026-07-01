// Edge-function copy of the per-method "How to pay" instructions. Mirror of the
// *logic* in src/lib/payment-instructions.ts — but shop values are read from the
// same fundive.config.ts as the app (pure data, no imports, so Deno reads it
// fine), so they can't drift. Keep any COPY changes in sync between the two.

import { siteConfig } from "../../../fundive.config.ts"

export const SHOP_PHONE    = siteConfig.contact.phone
export const SHOP_ADDRESS  = siteConfig.contact.address
export const SHOP_MAPS_URL = siteConfig.contact.mapsUrl

export const PAYPAL_LINK = siteConfig.contact.paypalLink

const CARD_SURCHARGE = `+${siteConfig.business.cardSurchargePercent}%`

// PDF wire labels are the SPA's payment_method values passed straight
// through (no more bank_transfer→bank or credit_card→paypal remapping).
// Strings widened so anything unrecognized still hits the `null` branch.
export type PdfPaymentMethod = "bank_transfer" | "credit_card" | "paypal" | "cash" | string

export interface PaymentInstructions {
  title: string
  lines: string[]
}

export function paymentInstructionsFor(
  method: PdfPaymentMethod,
  opts: { invoiceEmail?: string | null } = {},
): PaymentInstructions | null {
  switch (method) {
    case "cash":
      return {
        title: "How to pay — Cash",
        lines: [
          "Bring your payment to the shop in person.",
          `Phone: ${SHOP_PHONE}`,
          `Address: ${SHOP_ADDRESS}`,
          `Map: ${SHOP_MAPS_URL}`,
        ],
      }
    case "bank_transfer":
      return {
        title: "How to pay — Local bank transfer",
        lines: [
          "We'll email you our bank transfer details shortly so you can complete your payment.",
        ],
      }
    case "paypal":
      return {
        title: `How to pay — PayPal (${CARD_SURCHARGE})`,
        lines: [
          "Send your payment via PayPal:",
          PAYPAL_LINK,
          "Include your full name in the payment note so we can match it to your booking.",
        ],
      }
    case "credit_card": {
      const target = (opts.invoiceEmail && opts.invoiceEmail.trim()) || "your registered email"
      return {
        title: `How to pay — Credit card (${CARD_SURCHARGE})`,
        lines: [
          "We'll email you an invoice with a credit-card payment link.",
          `Invoice will be sent to: ${target}`,
        ],
      }
    }
    default:
      return null
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
    title: "After you pay",
    lines: [
      `Once you send your payment, please contact ${siteConfig.identity.shortName} by email, LINE, or WhatsApp so we can confirm receipt.`,
      `Keep an eye on the ${siteConfig.identity.shopName} app for updates to your registration status, payment confirmations, and event reminders.`,
    ],
  }
}
