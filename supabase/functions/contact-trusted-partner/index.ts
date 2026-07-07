// contact-trusted-partner — a diver picks one of the shop's trusted partner
// dive shops and sends them a message. Emails the partner FROM the shop address
// (so they know the business brokered it), CC's the shop inbox, and sets
// reply-to to the diver so the partner answers them directly. No DB write.
//
// The partner's email is resolved server-side (service role) from partner_id —
// it is never exposed to the client (RLS hides the trusted_partners rows from
// divers; they only see name/region/blurb via list_trusted_partners()).
//
// list_trusted_partners() lists two catalogs a diver can message: the
// standalone trusted_partners directory and the Packages partner_shops (whose
// contact_email is the reachable address). ids don't collide (both random
// uuids), so we resolve partner_id against trusted_partners first, then fall
// back to partner_shops.
//
// Flow:
//   1. Verify caller via Bearer JWT.
//   2. Validate { partner_id, message }.
//   3. Resolve the partner's email + name (service role); 404 if inactive/gone.
//   4. Look up the caller's profile name so the partner sees who's asking.
//   5. Email the partner.
//
// Body: { partner_id: string, message: string }
// Returns: 200 { ok: true }
//          400 { error } on bad input / no user email
//          401 on a bad/absent Bearer token
//          404 { error } when the partner is missing or retired

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import { parseContactPartnerInput, buildTrustedPartnerEmail } from "../_shared/trusted-partners.ts"
import { siteConfig } from "../../../fundive.config.ts"

const COMPANY_EMAIL = siteConfig.contact.email

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
  const parsed = parseContactPartnerInput(body as Record<string, unknown>)
  if ("error" in parsed) return json({ error: parsed.error }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Resolve the partner across both catalogs the diver sees on the Trusted
  // Partners page. trusted_partners first; then partner_shops (Packages), where
  // contact_email is the reachable address. Only active rows count.
  let partnerName: string | null = null
  let partnerEmail: string | null = null

  const { data: tp, error: tpErr } = await admin
    .from("trusted_partners")
    .select("name, email, active")
    .eq("id", parsed.request.partnerId)
    .maybeSingle()
  if (tpErr) return json({ error: safeError(tpErr, "partner lookup failed") }, 500)
  if (tp && tp.active) { partnerName = tp.name; partnerEmail = tp.email }

  if (!partnerEmail) {
    const { data: shop, error: shopErr } = await admin
      .from("partner_shops")
      .select("name, contact_email, active")
      .eq("id", parsed.request.partnerId)
      .maybeSingle()
    if (shopErr) return json({ error: safeError(shopErr, "partner lookup failed") }, 500)
    if (shop && shop.active && shop.contact_email) {
      partnerName = shop.name
      partnerEmail = shop.contact_email
    }
  }

  if (!partnerName || !partnerEmail) return json({ error: "partner not found" }, 404)

  const { data: profile } = await admin
    .from("profiles").select("name, nickname").eq("id", userId).maybeSingle()
  const diverName = [profile?.name, profile?.nickname ? `(${profile.nickname})` : null]
    .filter(Boolean)
    .join(" ")

  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "email not configured" }, 500)
  }

  const { subject, text } = buildTrustedPartnerEmail({
    shopName:    siteConfig.identity.shopName,
    partnerName: partnerName,
    diverName,
    diverEmail:  userEmail,
    message:     parsed.request.message,
  })

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    await transporter.sendMail({
      from:    { name: siteConfig.identity.shopName, address: GMAIL_USER },
      to:      partnerEmail,
      cc:      COMPANY_EMAIL,
      replyTo: userEmail,
      subject,
      text,
    })
  } catch (e) {
    return json({ error: `email failed: ${(e as Error).message}` }, 500)
  }

  return json({ ok: true })
})
