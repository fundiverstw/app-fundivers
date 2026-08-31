// Who a request came from, for the two guest-facing signup paths.
//
// Both create-registration and create-account spend a per-IP budget before
// they will mint an auth user, and both hash the IP before it touches the
// database (signup_attempts stores a digest, never an address). That logic was
// private to create-registration until create-account needed the same two
// functions; it lives here so the funnels can't drift into disagreeing about
// what "the same visitor" means.
//
// Deno-import-free on purpose: both handlers are unit-tested from Node, so
// anything they reach has to import cleanly there too.

/**
 * The caller's IP. Cloudflare's header is authoritative when the function is
 * fronted by CF (Workers and Pages are); the XFF / X-Real-IP chain is the
 * next-best effort. Null when nothing usable was sent — callers hash a
 * constant in that case rather than skipping the limit.
 */
export function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip")
  if (cf) return cf
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim() || null
  return req.headers.get("x-real-ip")
}

/** Lowercase hex SHA-256, for the bytea the rate-limit RPC keys on. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes  = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}
