// Edge-function copy of the per-method "How to pay" instructions. Mirror
// of src/lib/payment-instructions.ts — keep both files in sync when copy
// changes (Deno can't import across into src/).

export const SHOP_PHONE   = "+886 909-083-683"
export const SHOP_ADDRESS = "No. 8, Heping St, Yonghe District, New Taipei City, 23446"

export const BANK_CODE           = "822"
export const BANK_ACCOUNT_NUMBER = "1305 4100 1904"
export const BANK_ACCOUNT_NAME   = "Wong, Dennis"
export const BANK_BRANCH         = "Shuang He"

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
