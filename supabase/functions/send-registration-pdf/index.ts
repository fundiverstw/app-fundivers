// send-registration-pdf — on-demand email of a registration summary PDF
// to both fundiverstw@gmail.com and the diver who just booked. Called by
// the PWA right after a successful booking insert (direct flow) and by
// the auto-resume effect in RegisterPage after an email-confirmation
// return.
//
// Architecture: runs under Supabase Edge Functions (Deno 2 runtime). The
// function fetches the booking under the caller's JWT (so RLS decides
// whether they can see it), then gathers the remaining data (profile,
// EO_* event, rooms, addons, auth email) under the service role before
// building a jsPDF PDF and mailing it via Gmail SMTP (nodemailer).
//
// Secrets required (set via `supabase secrets set`):
//   GMAIL_USER          — gmail account that sends the mail
//   GMAIL_APP_PASSWORD  — gmail app password (not the normal password)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are auto-
// injected by the edge runtime.

import { createClient } from "jsr:@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.14"
import { Buffer } from "node:buffer"
import { buildPdfBase64, type RegistrationPdfPayload } from "./pdf.ts"

const COMPANY_EMAIL = "fundiverstw@gmail.com"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  })
}

// Paid-method enum in our schema is bank_transfer / credit_card / cash;
// the Wix PDF builder expects bank / paypal / cash. Map between.
function paymentWireLabel(m: string | null | undefined): string {
  if (m === "bank_transfer") return "bank"
  if (m === "credit_card")   return "paypal"
  return m ?? ""
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)

  const { booking_id } = await req.json().catch(() => ({}))
  if (!booking_id || typeof booking_id !== "string") {
    return json({ error: "booking_id required" }, 400)
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!

  // Caller-bound client — RLS applies. Used to verify the caller is
  // allowed to see this booking (either they own it, or they're admin).
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth:   { persistSession: false },
  })

  const { data: booking, error: bErr } = await caller
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .maybeSingle()
  if (bErr) return json({ error: bErr.message }, 500)
  if (!booking) return json({ error: "booking not found" }, 404)

  // Service-role client — bypasses RLS so we can resolve everything we
  // need for the PDF regardless of who's calling.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const [{ data: profile }, { data: authUser }] = await Promise.all([
    admin.from("profiles").select("*").eq("id", booking.user_id).maybeSingle(),
    admin.auth.admin.getUserById(booking.user_id),
  ])
  const registrantEmail = authUser?.user?.email
  if (!registrantEmail) return json({ error: "user has no email" }, 400)

  let event: Record<string, unknown> | null = null
  if (booking.eo_dive_id) {
    const { data } = await admin.from("EO_dives").select("*").eq("_id", booking.eo_dive_id).maybeSingle()
    event = data as Record<string, unknown> | null
  } else if (booking.eo_course_id) {
    const { data } = await admin.from("EO_courses").select("*").eq("_id", booking.eo_course_id).maybeSingle()
    event = data as Record<string, unknown> | null
  }

  const details = (booking.details ?? {}) as Record<string, unknown>
  const roomDetail = details.room as { option_id?: string; notes?: string } | undefined
  const addOnIds   = Array.isArray(details.add_ons) ? details.add_ons as string[] : []
  const gearDetail = details.gear as { rent?: boolean; mode?: string; items?: string[] } | undefined

  // Resolve room display-name (+added price).
  let roomBoard: string | null = null
  if (roomDetail?.option_id) {
    const { data: r } = await admin
      .from("EO_rooms")
      .select("title, display_name, added_price")
      .eq("_id", roomDetail.option_id)
      .maybeSingle()
    if (r) {
      const label = (r.display_name ?? r.title ?? "Room") as string
      roomBoard = r.added_price != null ? `${label} (+${r.added_price})` : label
    }
  }

  // Resolve add-on display names.
  let otherAddons: string[] = []
  if (addOnIds.length) {
    const { data: as } = await admin
      .from("Other_Addons")
      .select("_id, title, display_name")
      .in("_id", addOnIds)
    otherAddons = (as ?? [])
      .map((a: { title?: string | null; display_name?: string | null }) =>
        (a.display_name ?? a.title ?? "") as string)
      .filter((s: string) => s.length > 0)
  }

  const payload: RegistrationPdfPayload = {
    eventTitle: (event?.dive_title ?? event?.course_title ?? event?.title ?? "Event") as string,
    startDate:  (event?.start_date ?? null) as string | null,
    endDate:    (event?.end_date ?? null) as string | null,
    name:            profile?.full_name ?? "",
    email:           registrantEmail,
    dob:             profile?.date_of_birth ?? null,
    nationality:     profile?.nationality ?? null,
    idNumber:        profile?.id_number ?? null,
    contactMethod:   profile?.contact_method ?? null,
    contactId:       profile?.contact_id ?? null,
    certLevel:       profile?.cert_level ?? null,
    certOrg:         profile?.cert_agency ?? null,
    diverNitrox:     !!profile?.nitrox_certified,
    addNitroxCourse: !!details.nitrox_course_addon,
    loggedDives:     profile?.logged_dives ?? null,
    lastDiveDate:    profile?.last_dive_date ?? null,
    roomBoard,
    roomNotes:       roomDetail?.notes ?? null,
    otherAddons,
    rentGear:        !!gearDetail?.rent,
    gearMode:        (gearDetail?.mode ?? "") as RegistrationPdfPayload["gearMode"],
    gearItems:       gearDetail?.items ?? [],
    diveDays:        (event?.dive_days as number | null) ?? 1,
    height:          profile?.height_cm ?? null,
    weight:          profile?.weight_kg ?? null,
    shoeSize:        profile?.shoe_size ?? null,
    needsRide:       !!details.transportation,
    notes:           booking.notes ?? null,
    paymentMethod:   paymentWireLabel(details.payment_method as string | null | undefined),
    deposit:         (details.deposit as number | null) ?? null,
    total:           (details.total as number | null) ?? null,
  }

  const GMAIL_USER = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS = Deno.env.get("GMAIL_APP_PASSWORD")
  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set (supabase secrets set)" }, 500)
  }

  const base64 = await buildPdfBase64(payload)
  const buf    = Buffer.from(base64, "base64")

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  })

  const subject = `Registration - ${payload.eventTitle} | FunDivers TW`
  const mailOpts = {
    from: { name: "FunDivers TW", address: GMAIL_USER },
    subject,
    attachments: [{ filename: "registration.pdf", content: buf, contentType: "application/pdf" }],
  }

  await transporter.sendMail({ ...mailOpts, to: COMPANY_EMAIL, text: "Registration summary attached." })
  if (registrantEmail.toLowerCase().trim() !== COMPANY_EMAIL) {
    await transporter.sendMail({
      ...mailOpts,
      to: registrantEmail,
      text: "Thanks for registering — your registration summary is attached. We'll reach out shortly to confirm payment details.",
    })
  }

  return json({ ok: true })
})
