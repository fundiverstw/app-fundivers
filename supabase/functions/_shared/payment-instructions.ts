// Edge-function copy of the per-method "How to pay" instructions. Mirror
// of src/lib/payment-instructions.ts — keep both files in sync when copy
// changes (Deno can't import across into src/).

export const SHOP_PHONE   = "+886 909-083-683"
export const SHOP_ADDRESS = "No. 8, Heping St, Yonghe District, New Taipei City, 23446"

// Placeholders — replace with real values when the shop confirms them.
export const BANK_ACCOUNT_NAME   = "[Account name — TBD]"
export const BANK_NAME           = "[Bank name — TBD]"
export const BANK_ACCOUNT_NUMBER = "[Account number — TBD]"

// Methods are written by the SPA as bank_transfer/credit_card/cash; the
// edge function maps to bank/paypal/cash before passing to the PDF, so
// this file accepts the wire format the PDF already uses.
export type PdfPaymentMethod = "bank" | "paypal" | "cash" | string

export interface PaymentInstructions {
  title: string
  lines: string[]
}

export function paymentInstructionsFor(method: PdfPaymentMethod): PaymentInstructions | null {
  switch (method) {
    case "cash":
      return {
        title: "How to pay — Cash",
        lines: [
          "Bring your payment to the shop in person.",
          `Phone: ${SHOP_PHONE}`,
          `Address: ${SHOP_ADDRESS}`,
        ],
      }
    case "bank":
      return {
        title: "How to pay — Bank transfer",
        lines: [
          "Transfer to the shop's bank account:",
          `Account name: ${BANK_ACCOUNT_NAME}`,
          `Bank: ${BANK_NAME}`,
          `Account number: ${BANK_ACCOUNT_NUMBER}`,
        ],
      }
    case "paypal":
      return {
        title: "How to pay — Credit card (via PayPal)",
        lines: [
          "You'll receive a PayPal payment link by email shortly.",
          "Pay with any credit card through that link — no PayPal account needed.",
        ],
      }
    default:
      return null
  }
}
