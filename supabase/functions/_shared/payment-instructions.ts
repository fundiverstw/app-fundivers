// Edge-function copy of the per-method "How to pay" instructions. Mirror of the
// *logic* in src/lib/payment-instructions.ts — shop values are read from the
// same fundive.config.ts and the copy from the same message catalog (both pure
// data, so Deno reads them fine), which means neither can drift between the two.
//
// PINNED TO ENGLISH, deliberately. The only consumer is pdf.ts, which renders
// with jsPDF's built-in `helvetica` — a WinAnsi font with no CJK glyphs. Passing
// zh-TW / ja text through it does not fail; it silently emits mangled bytes
// (「防寒衣」 → `–2[Òˆc`). Until a CJK font is embedded via addFileToVFS/addFont,
// an English PDF is legible and a "translated" one is not. The SPA form uses the
// locale catalog (src/lib/payment-instructions.ts); this side reads `en`
// directly, so the copy still has exactly one source.

import { siteConfig } from "../../../fundive.config.ts"
import { en } from "../../../src/i18n/messages/en.ts"

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
  const p = en.paymentInstructions
  switch (method) {
    case "cash":
      return {
        title: p.cashTitle,
        lines: [
          p.cashLine,
          p.phone(SHOP_PHONE),
          p.address(SHOP_ADDRESS),
          p.map(SHOP_MAPS_URL),
        ],
      }
    case "bank_transfer":
      return {
        title: p.bankTitle,
        lines: [p.bankLine],
      }
    case "paypal":
      return {
        title: p.paypalTitle(CARD_SURCHARGE),
        lines: [
          p.paypalLine,
          PAYPAL_LINK,
          p.paypalNote,
        ],
      }
    case "credit_card": {
      const target = (opts.invoiceEmail && opts.invoiceEmail.trim()) || p.registeredEmail
      return {
        title: p.cardTitle(CARD_SURCHARGE),
        lines: [
          p.cardLine,
          p.invoiceTo(target),
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
  const p = en.paymentInstructions
  return {
    title: p.afterTitle,
    lines: [
      p.afterContact(siteConfig.identity.shortName),
      p.afterApp(siteConfig.identity.shopName),
    ],
  }
}
