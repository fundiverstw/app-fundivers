// notify-event-cancellation — email every non-cancelled registrant of a
// dive/course that an admin just cancelled. Push + in-app inbox are handled
// separately by the push worker's /admin-event-cancellation endpoint (it
// owns the VAPID key); this function exists only because Cloudflare Workers
// can't talk SMTP, so Gmail SMTP lives here in Deno-land like the other
// email-sending functions.
//
// Called from the SPA by the admin who cancelled the event, so it is gated
// on the caller's JWT having profiles.role = 'admin' (not the worker-only
// service-role gate that notify-waitlist-offer uses).
//
// Body: { event_id: string, event_type: EventKind }
// Returns: 200 { ok: true, sent, recipients }

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import { buildCancellationEmail } from "../_shared/event-cancellation-email.ts"
import { siteConfig } from "../../../fundive.config.ts"
import { isEventKind, EVENT_KINDS } from "../../../src/lib/event-kinds.ts"

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: prof } = await admin.from("profiles").select("role").eq("id", u.user.id).maybeSingle()
  if (prof?.role !== "admin") return json({ error: "forbidden" }, 403)

  let body: { event_id?: string; event_type?: string }
  try { body = await req.json() } catch { return json({ error: "invalid json" }, 400) }
  const eventId   = (body.event_id ?? "").trim()
  const eventType = body.event_type
  if (!eventId) return json({ error: "event_id required" }, 400)
  if (!isEventKind(eventType)) return json({ error: `event_type must be one of: ${EVENT_KINDS.join(", ")}` }, 400)

  if (!GMAIL_USER || !GMAIL_PASS) return json({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set" }, 500)

  let eventTitle = "Event"
  {
    const { data } = await admin.from("events").select("display_title, admin_title").eq("id", eventId).maybeSingle()
    eventTitle = (data?.display_title ?? data?.admin_title ?? eventTitle) as string
  }

  const { data: bookings, error: bErr } = await admin
    .from("bookings")
    .select("user_id")
    .eq("event_id", eventId)
    .neq("status", "cancelled")
  if (bErr) return json({ error: safeError(bErr, "bookings lookup failed") }, 500)

  const recipientIds = [...new Set((bookings ?? []).map(b => b.user_id))]
  if (!recipientIds.length) return json({ ok: true, sent: 0, recipients: 0 })

  const emails: string[] = []
  for (const uid of recipientIds) {
    const { data: target } = await admin.auth.admin.getUserById(uid)
    const email = target?.user?.email
    if (email) emails.push(email)
  }
  const uniqueEmails = [...new Set(emails)]
  if (!uniqueEmails.length) return json({ ok: true, sent: 0, recipients: 0 })

  const { subject, text } = buildCancellationEmail(eventTitle)

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  })

  let sent = 0
  for (const to of uniqueEmails) {
    try {
      await transporter.sendMail({
        from: { name: siteConfig.identity.shopName, address: GMAIL_USER },
        to,
        subject,
        text,
      })
      sent++
    } catch { /* best-effort per recipient — one bad address shouldn't abort the rest */ }
  }

  return json({ ok: true, sent, recipients: uniqueEmails.length })
})
