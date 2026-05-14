// Per-method "How to pay" copy shown on the registration form's step 4 and
// embedded in the emailed PDF. Lives in src/lib so the SPA can import it
// directly; the edge function has a parallel copy under
// supabase/functions/_shared/payment-instructions.ts (Deno can't reach
// across into src/), so when copy changes here, mirror it there too.

export const SHOP_PHONE    = '+886 909-083-683'
export const SHOP_ADDRESS  = 'No. 8, Heping St, Yonghe District, New Taipei City, 23446'
export const SHOP_MAPS_URL = 'https://maps.app.goo.gl/tDgtMirMrNX9QEjAA'

export const BANK_CODE           = '822'
export const BANK_ACCOUNT_NUMBER = '1305 4100 1904'
export const BANK_ACCOUNT_NAME   = 'Wong, Dennis'
export const BANK_BRANCH         = 'Shuang He'

export const PAYPAL_LINK = 'https://paypal.me/fundiverstw'

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
          `Code: ${BANK_CODE}`,
          `Account: ${BANK_ACCOUNT_NUMBER}`,
          `Name: ${BANK_ACCOUNT_NAME}`,
          `Branch: ${BANK_BRANCH}`,
        ],
      }
    case 'paypal':
      return {
        title: 'How to pay — PayPal (+5%)',
        lines: [
          'Send your payment via PayPal:',
          PAYPAL_LINK,
          'Include your full name in the payment note so we can match it to your booking.',
        ],
      }
    case 'credit_card': {
      const target = (opts.invoiceEmail && opts.invoiceEmail.trim()) || 'your registered email'
      return {
        title: 'How to pay — Credit card (+5%)',
        lines: [
          "We'll email you an invoice with a credit-card payment link.",
          `Invoice will be sent to: ${target}`,
        ],
      }
    }
  }
}
