// create-registration — Deno entry. All business logic lives in
// handler.ts so vitest can unit-test it from Node with mocked
// dependencies. This file's only job is to build production deps
// (real supabase-js clients, real nodemailer, real PDF builder) and
// forward the Request to the handler.

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { buildPdfBase64 } from "../_shared/pdf.ts"
import { shopEmail } from "../_shared/shop-contact.ts"
import { handleRegistration, type Deps } from "./handler.ts"
import { siteConfig } from "../../../fundive.config.ts"


// Verifies a Cloudflare Turnstile token. Called from the handler's
// guest path. Hard fail on missing env in production is enforced
// further up — if we get here, TURNSTILE_SECRET is set.
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
  const GMAIL_USER       = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS       = Deno.env.get("GMAIL_APP_PASSWORD")
  const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET")

  // Email is required in production. The handler accepts a null
  // transporter and silently skips email (used by tests + by an
  // intentional "no SMTP wired" deploy), so we 500 here rather than
  // there if the deploy is misconfigured.
  if (req.method === "POST" && (!GMAIL_USER || !GMAIL_PASS)) {
    return new Response(
      JSON.stringify({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set (supabase secrets set)" }),
      { status: 500, headers: { "content-type": "application/json" } },
    )
  }
  // Turnstile is required in production. Use Cloudflare's always-pass
  // test secret `1x0000000000000000000000000000000AA` for local dev.
  // Tests inject a stub verifyTurnstile and never reach this branch.
  if (req.method === "POST" && !TURNSTILE_SECRET) {
    return new Response(
      JSON.stringify({ error: "TURNSTILE_SECRET must be set (supabase secrets set)" }),
      { status: 500, headers: { "content-type": "application/json" } },
    )
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const anon  = createClient(SUPABASE_URL, ANON_KEY,    { auth: { persistSession: false } })

  const deps: Deps = {
    admin,
    anon,
    makeAuthedClient: (token) => createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth:   { persistSession: false },
    }),
    transporter: (GMAIL_USER && GMAIL_PASS) ? nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    }) : null,
    buildPdfBase64,
    env: {
      // The address the shop reads its own mail at — a row an admin edits, so
      // read per request. Falls back to the mailbox this sends as.
      companyEmail:    await shopEmail(admin, GMAIL_USER ?? ""),
      mailFromName:    siteConfig.identity.shopName,
      mailFromAddress: GMAIL_USER ?? "",
    },
    verifyTurnstile: (token, remoteIp) =>
      realVerifyTurnstile(TURNSTILE_SECRET!, token, remoteIp),
  }

  return handleRegistration(req, deps)
})
