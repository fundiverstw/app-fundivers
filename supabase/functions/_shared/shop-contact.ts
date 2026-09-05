// The shop's own contact details, for the functions that need them.
//
// They used to be `siteConfig.contact.*`, read at module load from a file
// baked into the deployment. They are a row now (`shop_contact`), so an admin
// who changes the shop's email in Manage changes where a partner enquiry lands
// and who gets blind-copied on a new diver's welcome — without a redeploy of
// anything.
//
// Read per request rather than cached: these run rarely, the row is one line,
// and a cached copy would mean the change an admin just made not taking effect
// until the function happened to cold-start.

import type { ShopContact } from "../../../src/lib/payment-method-format.ts"

export interface ShopContactDetails extends ShopContact {
  email: string
}

export const NO_SHOP_CONTACT: ShopContactDetails = {
  email: "", phone: "", address: "", mapsUrl: null,
}

/** Minimal shape of the admin client, so this file does not pull in the
 *  Supabase types the handlers already carry. `PromiseLike` rather than
 *  `Promise` because a PostgREST builder is a thenable, not a promise. */
export interface ContactReader {
  from: (table: string) => {
    select: (columns: string) => {
      maybeSingle: () => PromiseLike<{ data: unknown }>
    }
  }
}

/**
 * The details, or the empty ones.
 *
 * Never throws: a missing row must not fail a registration or an enquiry. Every
 * caller already handles a blank — a PDF omits the line, and an email falls
 * back to the mailbox it is authenticated as.
 */
export async function fetchShopContact(admin: ContactReader): Promise<ShopContactDetails> {
  try {
    const { data: row } = await admin.from("shop_contact").select("*").maybeSingle()
    if (!row) return NO_SHOP_CONTACT
    const data = row as Record<string, unknown>
    return {
      email:   (data.email as string | null) ?? "",
      phone:   (data.phone as string | null) ?? "",
      address: (data.address as string | null) ?? "",
      mapsUrl: (data.maps_url as string | null) ?? null,
    }
  } catch (e) {
    console.error("shop_contact read failed:", (e as Error).message)
    return NO_SHOP_CONTACT
  }
}

/**
 * Just the address mail to the shop goes to.
 *
 * `fallback` is what to use when the shop has published none — every caller
 * passes the mailbox it is already authenticated as, because an enquiry that
 * goes nowhere is worse than one that goes to the shop's Gmail.
 */
export async function shopEmail(admin: ContactReader, fallback = ""): Promise<string> {
  const { email } = await fetchShopContact(admin)
  return email || fallback
}
