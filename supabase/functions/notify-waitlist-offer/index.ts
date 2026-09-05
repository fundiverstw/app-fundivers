// notify-waitlist-offer — send the "your waitlist spot just opened" email
// for one waitlist_offers row. Called from the push-cron worker over
// supabase.functions.invoke; the worker is the only authorized caller
// (verified by service-role bearer).
//
// Worker handles push directly (it owns webpush). This function exists
// solely because Cloudflare Workers can't talk SMTP — Gmail SMTP lives
// here, in Deno-land, like the other email-sending functions in this
// project.
//
// Body: { offer_id: string }
// Returns: { ok: true, sent: boolean } on success.

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, bearerToken } from "../_shared/responses.ts"
import { shopEmail } from "../_shared/shop-contact.ts"
import { siteConfig } from "../../../fundive.config.ts"
import { usesDateEnvelope } from "../../../src/lib/event-kinds.ts"


interface OfferEmailBody {
  offer_id: string
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")
  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set" }, 500)
  }

  // Worker-only auth gate. The worker calls invoke() with the service-role
  // client, which forwards the service-role key as the Bearer. We verify
  // the value matches our local SERVICE_KEY env so a leaked anon key can't
  // call this endpoint and trigger emails.
  const token = bearerToken(req) ?? ""
  if (token !== SERVICE_KEY) return json({ error: "unauthorized" }, 401)

  let body: OfferEmailBody
  try { body = await req.json() as OfferEmailBody } catch { return json({ error: "invalid json" }, 400) }
  if (!body.offer_id) return json({ error: "offer_id required" }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: offer, error: oErr } = await admin
    .from("waitlist_offers")
    .select("id, expires_at, status, booking_id, offered_at, notified_at")
    .eq("id", body.offer_id)
    .maybeSingle()
  if (oErr || !offer) return json({ error: "offer not found" }, 404)
  if (offer.status !== "pending") return json({ ok: true, sent: false, reason: "offer not pending" })

  // Audit L2 — defense in depth against a leaked service-role key
  // being used to mass-replay legitimate offer_ids. Reject offers
  // older than 1h (the worker fires within seconds of offer creation;
  // a 1h+ gap means something abnormal) and offers already marked
  // notified_at (re-sending the same email is the replay surface).
  const offeredAt = new Date(offer.offered_at as string).getTime()
  if (Number.isFinite(offeredAt) && Date.now() - offeredAt > 60 * 60 * 1000) {
    return json({ ok: true, sent: false, reason: "offer is stale" })
  }
  if (offer.notified_at) {
    return json({ ok: true, sent: false, reason: "offer already notified" })
  }

  const { data: booking } = await admin
    .from("bookings")
    .select("user_id, event_id")
    .eq("id", offer.booking_id)
    .maybeSingle()
  if (!booking) return json({ error: "booking not found" }, 404)

  let eventTitle = "Event"
  let startDate: string | null = null
  if (booking.event_id) {
    const { data } = await admin.from("events")
      .select("kind, display_title, admin_title, start_date, course_days")
      .eq("id", booking.event_id).maybeSingle()
    eventTitle = (data?.display_title ?? data?.admin_title ?? eventTitle) as string
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

  // Format expiry as a human-readable timestamp in Asia/Taipei (the only
  // timezone this app serves). The `Intl` formatter is built into Deno.
  const expiresAt = new Date(offer.expires_at)
  const tpe = new Intl.DateTimeFormat("en-GB", {
    timeZone: siteConfig.locale.timezone,
    year:  "numeric", month: "short", day: "2-digit",
    hour:  "2-digit", minute: "2-digit",
  }).format(expiresAt)

  const subject = `waitlist-offer--${eventTitle}`
  const dateLine = startDate ? ` (${startDate})` : ""
  const text =
    `Good news — a spot just opened up for ${eventTitle}${dateLine}, and you're next in line.\n\n` +
    `Open the ${siteConfig.identity.shortName} app and tap "Accept this spot" on your booking before ${tpe} (${siteConfig.locale.timezone}). ` +
    `If we don't hear from you by then, the offer rolls to the next person on the waitlist.\n\n` +
    `— ${siteConfig.identity.shopName}`

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

  // Stamp notified_at so a subsequent call (worker retry, replay
  // attempt) is rejected by the L2 guard above instead of re-sending.
  await admin.from("waitlist_offers").update({ notified_at: new Date().toISOString() }).eq("id", offer.id)

  return json({ ok: true, sent: true })
})
