// Edge-function binding of the shared "How to pay" renderer. Mirror of
// src/lib/payment-instructions.ts — same shop config, same message catalog,
// same src/lib/payment-method-format.ts renderer — so the PDF cannot drift
// from what the diver saw on the register form.

import { siteConfig } from "../../../fundive.config.ts"
import { t } from "./i18n.ts"
import {
  paymentMethodInstructions,
  type PaymentInstructions,
  type PaymentMethodDetails,
  type PaymentMethodLabels,
  type ShopContact,
} from "../../../src/lib/payment-method-format.ts"

export type { PaymentInstructions, PaymentMethodDetails }

export const SHOP_PHONE    = siteConfig.contact.phone
export const SHOP_ADDRESS  = siteConfig.contact.address
export const SHOP_MAPS_URL = siteConfig.contact.mapsUrl

const SHOP: ShopContact = {
  phone:   SHOP_PHONE,
  address: SHOP_ADDRESS,
  mapsUrl: SHOP_MAPS_URL,
}

function labels(): PaymentMethodLabels {
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
 * Build the block for the method snapshotted onto the PDF payload. Null when
 * the booking's payment_method no longer resolves to a row (a method the shop
 * deleted) — the PDF then simply omits the section rather than inventing one.
 */
export function paymentInstructionsFor(
  method: PaymentMethodDetails | null | undefined,
  opts: { invoiceEmail?: string | null } = {},
): PaymentInstructions | null {
  if (!method) return null
  return paymentMethodInstructions(method, {
    labels: labels(),
    shop: SHOP,
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
