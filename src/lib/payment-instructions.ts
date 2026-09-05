// Per-method "How to pay" copy shown on the registration form's step 4 and
// embedded in the emailed PDF. The method itself is shop-authored (the
// payment_methods table); this module only binds the deployment's field labels
// and shop contact details to the shared renderer. The edge function keeps a
// parallel binding under supabase/functions/_shared/payment-instructions.ts —
// both feed the same renderer, so neither the values nor the copy can drift.

import { siteConfig } from '../config/site'
import { t } from '../i18n'
import {
  paymentMethodInstructions,
  type PaymentInstructions,
  type PaymentMethodDetails,
  type PaymentMethodLabels,
  type ShopContact,
} from './payment-method-format'

export type { PaymentInstructions } from './payment-method-format'

/** The details a cash method prints, when the shop has published none. Empty
 *  rather than absent so the renderer's own "omit a blank row" rule applies. */
export const NO_SHOP: ShopContact = { phone: '', address: '', mapsUrl: null }

export function paymentMethodLabels(): PaymentMethodLabels {
  const p = t.paymentInstructions
  return {
    howToPay:           p.howToPay,
    bankName:           p.bankName,
    bankBranch:         p.bankBranch,
    bankCode:           p.bankCode,
    accountNumber:      p.accountNumber,
    accountHolder:      p.accountHolder,
    swift:              p.swift,
    payOnline:          p.payOnline,
    phone:              p.phone,
    address:            p.address,
    map:                p.map,
    invoiceTo:          p.invoiceTo,
    registeredEmail:    p.registeredEmail,
    bankDetailsPending: p.bankDetailsPending,
  }
}

/**
 * The block for one method.
 *
 * The shop's phone / address / map are passed in rather than imported: they are
 * shop-authored now (`shop_contact`), and a module constant read at import time
 * would print whatever was true when the tab was opened. Callers hold them
 * already — `useShopContact()` — and the edge function reads its own copy.
 */
export function paymentInstructionsFor(
  method: PaymentMethodDetails,
  opts: { invoiceEmail?: string | null; shop?: ShopContact } = {},
): PaymentInstructions {
  return paymentMethodInstructions(method, {
    labels: paymentMethodLabels(),
    shop: opts.shop ?? NO_SHOP,
    invoiceEmail: opts.invoiceEmail,
  })
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
