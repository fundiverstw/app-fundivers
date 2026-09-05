// notify-booking-confirmed — tell a diver the shop just promoted them off
// the waitlist.
//
// The automatic waitlist path already emails (notify-waitlist-offer): a spot
// frees, the cron worker offers it, the diver accepts. This covers the other
// path — an admin flipping a booking's status straight to `confirmed` on the
// event page. That write is silent, so the diver learned they were in only by
// happening to open the app.
//
// The SPA has already written the status by the time this is called; this
// endpoint only notifies. It re-reads the booking under service-role and
// refuses to send unless the row really is `confirmed`, so a caller can't
// hand it an arbitrary booking id and mail a diver about a seat they don't
// have.
//
// Body: { booking_id: string }
// Returns: { ok: true, sent: boolean, reason?: string }

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, bearerToken } from "../_shared/responses.ts"
import { buildWaitlistConfirmedEmail } from "../_shared/waitlist-confirmed-email.ts"
import { shopEmail } from "../_shared/shop-contact.ts"
import { siteConfig } from "../../../fundive.config.ts"
import { usesDateEnvelope } from "../../../src/lib/event-kinds.ts"

interface ConfirmedBody {
  booking_id: string
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

  let body: ConfirmedBody
  try { body = await req.json() as ConfirmedBody } catch { return json({ error: "invalid json" }, 400) }
  if (!body.booking_id) return json({ error: "booking_id required" }, 400)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  // Admin gate: pass the token explicitly (getUser() with no arg returns null
  // in contexts that don't persist a session).
  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", u.user.id)
    .maybeSingle()
  if (callerProfile?.role !== "admin") return json({ error: "forbidden" }, 403)

  const { data: booking } = await admin
    .from("bookings")
    .select("user_id, event_id, status")
    .eq("id", body.booking_id)
    .maybeSingle()
  if (!booking) return json({ error: "booking not found" }, 404)

  // The seat has to actually exist before we tell anyone about it. Guards both
  // a race (the admin flipped it back) and a caller passing a booking that was
  // never promoted.
  if (booking.status !== "confirmed") {
    return json({ ok: true, sent: false, reason: "booking is not confirmed" })
  }

  let eventTitle = ""
  let startDate: string | null = null
  if (booking.event_id) {
    const { data } = await admin.from("events")
      .select("kind, display_title, admin_title, start_date, course_days")
      .eq("id", booking.event_id).maybeSingle()
    eventTitle = (data?.display_title ?? data?.admin_title ?? "") as string
    // Dives carry start_date; courses derive it from the earliest course day.
    startDate = !data?.kind
      ? null
      : usesDateEnvelope(data.kind)
        ? ((data.start_date ?? null) as string | null)
        : ([...((data.course_days ?? []) as string[])].sort()[0] ?? null)
  }

  const { data: target } = await admin.auth.admin.getUserById(booking.user_id)
  const recipientEmail = target?.user?.email
  if (!recipientEmail) return json({ ok: true, sent: false, reason: "no email" })
  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ ok: true, sent: false, reason: "email not configured" })
  }

  const { subject, text } = buildWaitlistConfirmedEmail(eventTitle, startDate)

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    const shopMail = await shopEmail(admin)
    await transporter.sendMail({
      from:    { name: siteConfig.identity.shopName, address: GMAIL_USER },
      to:      recipientEmail,
      ...(shopMail ? { bcc: shopMail } : {}),
      subject,
      text,
    })
  } catch (e) {
    return json({ error: `email failed: ${(e as Error).message}` }, 500)
  }

  return json({ ok: true, sent: true })
})
