// partner-connect — a diver asks the shop for a vetted dive-shop
// recommendation at a destination they're travelling to. Emails the
// request to the shop inbox; no DB write.
//
// Flow:
//   1. Verify caller via Bearer JWT.
//   2. Validate { destination, note } from the body.
//   3. Look up the caller's profile name (service role) so the shop sees
//      who's asking without trusting a client-supplied name.
//   4. Email the request to the shop.
//
// Body: { destination: string, note?: string }
// Returns: 200 { ok: true }
//          400 { error } on a missing/over-long destination or note
//          401 on a bad/absent Bearer token

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import { takeActionSlot, rateLimitedBody } from "../_shared/rate-limit.ts"
import { parsePartnerConnectInput, buildPartnerConnectEmail } from "../_shared/partner-connect.ts"
import { siteConfig } from "../../../fundive.config.ts"
import { fetchShopContact } from "../_shared/shop-contact.ts"

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const userId = u.user.id
  const userEmail = u.user.email
  if (!userEmail) return json({ error: "user has no email on file" }, 400)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid body" }, 400) }
  const parsed = parsePartnerConnectInput(body as Record<string, unknown>)
  if ("error" in parsed) return json({ error: parsed.error }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Abuse ceiling: this endpoint sends mail on the caller's say-so, so an
  // unbounded loop here burns the shop's SMTP quota and takes down every other
  // transactional email with it. Limits live in _shared/rate-limit.ts.
  const slot = await takeActionSlot(admin, userId, "partner_connect")
  if (!slot.allowed) {
    return json(rateLimitedBody("partner_connect", slot.retryAfterSeconds), 429)
  }
  const { data: profile, error: pErr } = await admin
    .from("profiles")
    .select("name, nickname")
    .eq("id", userId)
    .maybeSingle()
  if (pErr) return json({ error: safeError(pErr, "profile lookup failed") }, 500)

  const diverName = [profile?.name, profile?.nickname ? `(${profile.nickname})` : null]
    .filter(Boolean)
    .join(" ")

  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "email not configured" }, 500)
  }

  const { subject, text } = buildPartnerConnectEmail({
    diverName,
    diverEmail: userEmail,
    destination: parsed.request.destination,
    note: parsed.request.note,
  })

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    // Where the shop reads its mail is a row an admin edits, not a config
    // literal. With none published the enquiry goes to the mailbox this is
    // authenticated as, which is the shop's own — an enquiry must not be
    // dropped because nobody has filled the field in yet.
    const shop = await fetchShopContact(admin)
    await transporter.sendMail({
      from:     { name: siteConfig.identity.shopName, address: GMAIL_USER },
      to:       shop.email || GMAIL_USER,
      replyTo:  userEmail,
      subject,
      text,
    })
  } catch (e) {
    return json({ error: `email failed: ${(e as Error).message}` }, 500)
  }

  return json({ ok: true })
})
