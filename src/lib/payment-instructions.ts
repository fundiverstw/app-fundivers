// Per-method "How to pay" copy shown on the registration form's step 4 and
// embedded in the emailed PDF. Lives in src/lib so the SPA can import it
// directly; the edge function has a parallel copy under
// supabase/functions/_shared/payment-instructions.ts (Deno can't reach
// across into src/), so when copy changes here, mirror it there too.

export const SHOP_PHONE   = '+886 909-083-683'
export const SHOP_ADDRESS = 'No. 8, Heping St, Yonghe District, New Taipei City, 23446'

export const BANK_CODE           = '822'
export const BANK_ACCOUNT_NUMBER = '1305 4100 1904'
export const BANK_ACCOUNT_NAME   = 'Wong, Dennis'
export const BANK_BRANCH         = 'Shuang He'

export type PaymentMethod = 'bank_transfer' | 'credit_card' | 'cash'

export interface PaymentInstructions {
  title: string
  lines: string[]
}

export function paymentInstructionsFor(method: PaymentMethod): PaymentInstructions {
  switch (method) {
    case 'cash':
      return {
        title: 'How to pay — Cash',
        lines: [
          'Bring your payment to the shop in person.',
          `Phone: ${SHOP_PHONE}`,
          `Address: ${SHOP_ADDRESS}`,
        ],
      }
    case 'bank_transfer':
      return {
        title: 'How to pay — Local bank transfer',
        lines: [
          `Code: ${BANK_CODE}`,
          `Account: ${BANK_ACCOUNT_NUMBER}`,
          `Name: ${BANK_ACCOUNT_NAME}`,
          `Branch: ${BANK_BRANCH}`,
        ],
      }
    case 'credit_card':
      return {
        title: 'How to pay — Credit card (via PayPal)',
        lines: [
          'You\'ll receive a PayPal payment link by email shortly.',
          'Pay with any credit card through that link — no PayPal account needed.',
        ],
      }
  }
}
