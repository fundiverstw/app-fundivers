// The shop's uploaded logo, for the PDFs that print it.
//
// `pdf.ts` has always drawn the logo vendored beside it (`fd_logo.png`), which
// is the deployment's own mark. A shop that uploads one in Manage → Shop
// Profile expects it on the registration PDF too — that document is the thing a
// diver keeps — so the builders ask here first and fall back to the file.
//
// The `shop-logo` bucket is public, so this is a plain fetch with no signing:
// the same URL the app's <img> uses. Read per PDF rather than cached, for the
// reason shop-contact.ts is: these run rarely, and a cached copy would mean the
// logo an admin just replaced not appearing until the function cold-starts.

import { Buffer } from "node:buffer"

const BUCKET = "shop-logo"

/** Minimal shape of the admin client — see ContactReader in shop-contact.ts. */
export interface LogoReader {
  from: (table: string) => {
    select: (columns: string) => {
      maybeSingle: () => PromiseLike<{ data: unknown }>
    }
  }
}

/** Public object URL for a path in the logo bucket. */
export function shopLogoUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${path}`
}

/**
 * The shop's uploaded logo as a PNG data URL, or null.
 *
 * Null covers every "use the bundled one" case — no upload, no `SUPABASE_URL`,
 * an unreachable bucket, a deleted object. Never throws: a PDF with the
 * deployment's own logo on it is a fine PDF, and one that failed to build
 * because a logo 404'd is not.
 */
export async function fetchShopLogoDataUrl(admin: LogoReader): Promise<string | null> {
  try {
    const { data: row } = await admin.from("shop_profile").select("logo_path").maybeSingle()
    const path = (row as { logo_path?: string | null } | null)?.logo_path
    if (!path) return null

    const base = typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_URL") : undefined
    if (!base) return null

    const res = await fetch(shopLogoUrl(base, path))
    if (!res.ok) return null

    const bytes = new Uint8Array(await res.arrayBuffer())
    return "data:image/png;base64," + Buffer.from(bytes).toString("base64")
  } catch (e) {
    console.error("shop logo read failed:", (e as Error).message)
    return null
  }
}
