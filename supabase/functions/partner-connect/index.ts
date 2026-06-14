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
import { corsOk, jsonResponse, safeError } from "../_shared/responses.ts"
import { parsePartnerConnectInput, buildPartnerConnectEmail } from "../_shared/partner-connect.ts"

const COMPANY_EMAIL = "fundiverstw@gmail.com"

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)
  const token = auth.slice("Bearer ".length)

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
    await transporter.sendMail({
      from:     { name: "FunDivers TW", address: GMAIL_USER },
      to:       COMPANY_EMAIL,
      replyTo:  userEmail,
      subject,
      text,
    })
  } catch (e) {
    return json({ error: `email failed: ${(e as Error).message}` }, 500)
  }

  return json({ ok: true })
})
