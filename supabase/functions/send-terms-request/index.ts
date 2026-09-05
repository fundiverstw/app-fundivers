// send-terms-request — admin endpoint behind the user card's "Send terms email".
//
// Mints a fresh one-time consent link for an existing account and emails it to
// that diver. The walk-in courtesy email already carries one; this covers the
// accounts minted before that existed, a link that expired, and the diver who
// deleted the first email.
//
// Consent is still the DIVER's act — this only hands them a way to give it that
// needs no password. Nothing here writes agreed_to_terms_*; only
// accept_terms_with_token() does, when they tap the button.
//
// Body: { user_id }
// Returns: { ok: true, email_sent, expires_at }

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import { shopEmail } from "../_shared/shop-contact.ts"
import {
  buildTermsRequestEmail, termsConsentUrl, TERMS_CONSENT_TOKEN_DAYS,
} from "../_shared/terms-consent-email.ts"
import { siteConfig } from "../../../fundive.config.ts"


Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

  let body: { user_id?: string }
  try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }
  const userId = body.user_id?.trim()
  if (!userId) return json({ error: "user_id required" }, 400)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: callerProfile } = await admin
    .from("profiles").select("role").eq("id", u.user.id).maybeSingle()
  if (callerProfile?.role !== "admin") return json({ error: "forbidden" }, 403)

  const { data: target } = await admin
    .from("profiles").select("email, name, nickname").eq("id", userId).maybeSingle()
  if (!target) return json({ error: "diver not found" }, 404)
  const to = (target as { email: string | null }).email
  if (!to) return json({ error: "that diver has no email address on file" }, 400)

  const expiresAt = new Date(Date.now() + TERMS_CONSENT_TOKEN_DAYS * 86_400_000).toISOString()
  const { data: tokenRow, error: tokenErr } = await admin
    .from("terms_consent_tokens")
    .insert({ user_id: userId, created_by: u.user.id, expires_at: expiresAt } as never)
    .select("token")
    .maybeSingle()
  if (tokenErr || !tokenRow) {
    return json({ error: safeError(tokenErr, "could not create the consent link") }, 500)
  }

  // Mail is the whole point here, unlike the courtesy email where the account
  // was the deliverable — so a send failure is this endpoint's failure.
  if (!GMAIL_USER || !GMAIL_PASS) return json({ error: "email is not configured" }, 500)
  const who = target as { name: string | null; nickname: string | null }
  const { subject, text } = buildTermsRequestEmail({
    name: who.name || who.nickname || to,
    acceptUrl: termsConsentUrl((tokenRow as { token: string }).token),
  })
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    const shopMail = await shopEmail(admin)
    await transporter.sendMail({
      from: { name: siteConfig.identity.shopName, address: GMAIL_USER },
      to,
      ...(shopMail ? { bcc: shopMail } : {}),
      subject,
      text,
    })
  } catch (e) {
    return json({ error: safeError(e, "could not send the email") }, 502)
  }

  return json({ ok: true, email_sent: true, expires_at: expiresAt })
})
