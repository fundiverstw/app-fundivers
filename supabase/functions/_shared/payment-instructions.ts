// Edge-function copy of the per-method "How to pay" instructions. Mirror
// of src/lib/payment-instructions.ts — keep both files in sync when copy
// changes (Deno can't import across into src/).

export const SHOP_PHONE    = "+886 909-083-683"
export const SHOP_ADDRESS  = "No. 8, Heping St, Yonghe District, New Taipei City, 23446"
export const SHOP_MAPS_URL = "https://maps.app.goo.gl/tDgtMirMrNX9QEjAA"

export const BANK_CODE           = "822"
export const BANK_ACCOUNT_NUMBER = "1305 4100 1904"
export const BANK_ACCOUNT_NAME   = "Wong, Dennis"
export const BANK_BRANCH         = "Shuang He"

export const PAYPAL_LINK = "https://paypal.me/fundiverstw"

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
          `Code: ${BANK_CODE}`,
          `Account: ${BANK_ACCOUNT_NUMBER}`,
          `Name: ${BANK_ACCOUNT_NAME}`,
          `Branch: ${BANK_BRANCH}`,
        ],
      }
    case "paypal":
      return {
        title: "How to pay — PayPal (+5%)",
        lines: [
          "Send your payment via PayPal:",
          PAYPAL_LINK,
          "Include your full name in the payment note so we can match it to your booking.",
        ],
      }
    case "credit_card": {
      const target = (opts.invoiceEmail && opts.invoiceEmail.trim()) || "your registered email"
      return {
        title: "How to pay — Credit card (+5%)",
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
      "Once you send your payment, please contact FunDivers by email, LINE, or WhatsApp so we can confirm receipt.",
      "Keep an eye on the FunDivers TW app for updates to your registration status, payment confirmations, and event reminders.",
    ],
  }
}
