// create-account — Deno entry. All business logic lives in handler.ts so
// vitest can unit-test it from Node with mocked dependencies. This file's only
// job is to build production deps and forward the Request.

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import { handleCreateAccount, type Deps } from "./handler.ts"

async function realVerifyTurnstile(
  secret: string,
  token: string,
  remoteIp: string | null,
): Promise<{ success: boolean; errorCodes?: string[] }> {
  const form = new FormData()
  form.append("secret",   secret)
  form.append("response", token)
  if (remoteIp) form.append("remoteip", remoteIp)
  try {
    const r = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form },
    )
    const j = await r.json() as { success: boolean; "error-codes"?: string[] }
    return { success: !!j.success, errorCodes: j["error-codes"] }
  } catch (e) {
    return { success: false, errorCodes: [`fetch_failed:${(e as Error).message}`] }
  }
}

Deno.serve(async (req) => {
  const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!
  const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET")

  // Turnstile is required. Without a secret we cannot verify the token, and
  // treating an unverifiable token as valid would leave the signup form open
  // to a script — so a misconfigured deploy fails loudly here rather than
  // quietly accepting everything. Cloudflare's always-pass test secret
  // `1x0000000000000000000000000000000AA` covers local dev.
  if (req.method === "POST" && !TURNSTILE_SECRET) {
    return new Response(
      JSON.stringify({ error: "TURNSTILE_SECRET must be set (supabase secrets set)" }),
      { status: 500, headers: { "content-type": "application/json" } },
    )
  }

  const deps: Deps = {
    admin: createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }),
    anon:  createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } }),
    verifyTurnstile: (token, remoteIp) =>
      realVerifyTurnstile(TURNSTILE_SECRET!, token, remoteIp),
  }

  return handleCreateAccount(req, deps)
})
