// create-registration — atomic submit endpoint for the registration form.
//
// Two callers, one path:
//   • Guest: body has { email, password }. We createUser with
//     email_confirm: true (skipping the click-to-confirm gate that
//     burned us before — typo'd email = silent drop), then run the
//     same insert/email pipeline as an authed user.
//   • Authed: caller passes a Bearer JWT. We use auth.uid() instead.
//
// Either way the function does, all under service role:
//   1. profile UPDATE (the handle_new_user trigger created the row)
//   2. booking INSERT
//   3. PDF build + Gmail SMTP to fundiverstw + the diver
//
// Returns { booking_id, session? }. session is set only on the guest
// path so the client can immediately setSession and skip a second
// round-trip. If the booking insert fails on the guest path we delete
// the just-created auth user so the form can be retried cleanly.

import { createClient } from "jsr:@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.14"
import { Buffer } from "node:buffer"
import { buildPdfBase64, type RegistrationPdfPayload } from "../_shared/pdf.ts"

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

interface RegistrationBody {
  email?:    string  // guest path only
  password?: string  // guest path only
  agreed_to_terms_at?: string

  event_type:  'dive' | 'course'
  event_id:    string
  profile_patch: Record<string, unknown>
  details:       Record<string, unknown>
  notes?:        string | null
}

// Schema enum is bank_transfer/credit_card/cash; the PDF builder
// expects bank/paypal/cash. Map between.
function paymentWireLabel(m: string | null | undefined): string {
  if (m === "bank_transfer") return "bank"
  if (m === "credit_card")   return "paypal"
  return m ?? ""
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  let body: RegistrationBody
  try { body = await req.json() as RegistrationBody } catch { return json({ error: "invalid json" }, 400) }

  if (!body.event_type || !body.event_id) {
    return json({ error: "event_type and event_id required" }, 400)
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")
  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "GMAIL_USER and GMAIL_APP_PASSWORD must be set (supabase secrets set)" }, 500)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  // Resolve the user — either from caller JWT (authed path) or by
  // creating one on the spot (guest path). Track createdGuest so we
  // can roll back the auth user if the booking insert later fails.
  let userId: string
  let registrantEmail: string
  let session: unknown = null
  let createdGuest = false

  const auth = req.headers.get("Authorization") ?? ""
  if (auth.startsWith("Bearer ") && !body.email) {
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
      auth:   { persistSession: false },
    })
    const { data: u, error: uErr } = await caller.auth.getUser()
    if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)
    userId = u.user.id
    registrantEmail = u.user.email ?? ""
    if (!registrantEmail) return json({ error: "user has no email" }, 400)
  } else {
    if (!body.email || !body.password) {
      return json({ error: "email and password required for guest path" }, 400)
    }
    const { data, error } = await admin.auth.admin.createUser({
      email:         body.email.trim(),
      password:      body.password,
      email_confirm: true, // bypass the click-to-confirm gate
      user_metadata: body.agreed_to_terms_at
        ? { agreed_to_terms_at: body.agreed_to_terms_at }
        : undefined,
    })
    if (error || !data.user) {
      return json({ error: error?.message ?? "createUser failed" }, 400)
    }
    userId = data.user.id
    registrantEmail = body.email.trim()
    createdGuest = true

    // Sign in immediately so the client can hold the session without a
    // second round-trip. signInWithPassword uses the anon client (the
    // service-role client doesn't have a "sign in" mode).
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data: si } = await anon.auth.signInWithPassword({
      email: registrantEmail, password: body.password,
    })
    session = si?.session ?? null
  }

  async function rollback(reason: string): Promise<Response> {
    if (createdGuest) {
      await admin.auth.admin.deleteUser(userId).catch(() => { /* best-effort */ })
    }
    return json({ error: reason }, 500)
  }

  // 1. Profile update
  const { error: profErr } = await admin
    .from("profiles")
    .update(body.profile_patch as never)
    .eq("id", userId)
  if (profErr) return rollback(profErr.message)

  // 2. Booking insert
  const fk = body.event_type === "dive"
    ? { eo_dive_id: body.event_id, eo_course_id: null }
    : { eo_dive_id: null, eo_course_id: body.event_id }
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .insert({
      user_id: userId,
      status:  "pending",
      notes:   body.notes ?? null,
      details: body.details,
      ...fk,
    })
    .select()
    .single()
  if (bErr || !booking) return rollback(bErr?.message ?? "booking insert failed")

  // 3. Build the PDF payload from data we already have or can fetch.
  //    Profile is read after the update so the PDF reflects what the
  //    diver just typed (the patch could be partial).
  const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).single()

  let event: Record<string, unknown> | null = null
  if (body.event_type === "dive") {
    const { data } = await admin.from("EO_dives").select("*").eq("_id", body.event_id).maybeSingle()
    event = data as Record<string, unknown> | null
  } else {
    const { data } = await admin.from("EO_courses").select("*").eq("_id", body.event_id).maybeSingle()
    event = data as Record<string, unknown> | null
  }

  const details = body.details as Record<string, unknown>
  const roomDetail = details.room as { option_id?: string; notes?: string } | undefined
  const addOnIds   = Array.isArray(details.add_ons) ? details.add_ons as string[] : []
  const gearDetail = details.gear as { rent?: boolean; included?: boolean; mode?: string; items?: string[] } | undefined

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

  // Resolve effective payment deadlines — admin-set values take precedence;
  // when null fall back to "7 days before start_date" (matches the SPA's
  // computeEffectiveDeadlines helper). Done here so the PDF and the form
  // always agree.
  const startDate = (event?.start_date ?? null) as string | null
  function shiftDays(yyyyMmDd: string, deltaDays: number): string {
    const d = new Date(yyyyMmDd + "T00:00:00Z")
    d.setUTCDate(d.getUTCDate() + deltaDays)
    return d.toISOString().slice(0, 10)
  }
  const fallbackDeadline = startDate ? shiftDays(startDate, -7) : null
  const depositDeadline      = (event?.deposit_deadline      as string | null) ?? fallbackDeadline
  const fullPaymentDeadline  = (event?.full_payment_deadline as string | null) ?? fallbackDeadline

  // Cancellation policy — resolve the FK so the PDF can render the full
  // text. Null when the event has no policy attached (legacy rows).
  let cancellationPolicyTitle: string | null = null
  let cancellationPolicyText:  string | null = null
  const policyId = event?.cancel_policy as string | null | undefined
  if (policyId) {
    const { data: pol } = await admin
      .from("cancellation_policies")
      .select("title, cancelation_policy")
      .eq("_id", policyId)
      .maybeSingle()
    if (pol) {
      cancellationPolicyTitle = (pol.title ?? null) as string | null
      cancellationPolicyText  = (pol.cancelation_policy ?? null) as string | null
    }
  }
  const cancelDate = (event?.cancel_date as string | null) ?? null
  const cancellationPolicyAckedAt = (details.cancellation_policy_acked_at as string | null) ?? null

  // Transport status — read the linked EO_prices row's transport surcharge.
  // NULL or 0 means transportation is bundled into the base price; the PDF
  // renders "Included with base price" instead of yes/no in that case.
  let transportIncluded = false
  const priceId = event?.price as string | null | undefined
  if (priceId) {
    const { data: pr } = await admin
      .from("EO_prices")
      .select("transport")
      .eq("_id", priceId)
      .maybeSingle()
    const transport = pr?.transport as number | null | undefined
    transportIncluded = transport == null || transport <= 0
  } else {
    // No price tier linked — treat as included (no surcharge to charge).
    transportIncluded = true
  }

  const payload: RegistrationPdfPayload = {
    eventTitle: (event?.dive_title ?? event?.course_title ?? event?.title ?? "Event") as string,
    startDate,
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
    gearIncluded:    !!gearDetail?.included,
    gearMode:        (gearDetail?.mode ?? "") as RegistrationPdfPayload["gearMode"],
    gearItems:       gearDetail?.items ?? [],
    diveDays:        (event?.dive_days as number | null) ?? 1,
    height:          profile?.height_cm ?? null,
    weight:          profile?.weight_kg ?? null,
    shoeSize:        profile?.shoe_size ?? null,
    needsRide:       !!details.transportation,
    transportIncluded,
    notes:           booking.notes ?? null,
    paymentMethod:   paymentWireLabel(details.payment_method as string | null | undefined),
    deposit:         (details.deposit as number | null) ?? null,
    total:           (details.total as number | null) ?? null,
    payDepositOnly:  !!details.pay_deposit_only,
    depositDeadline,
    fullPaymentDeadline,
    cancellationPolicyTitle,
    cancellationPolicyText,
    cancelDate,
    cancellationPolicyAckedAt,
  }

  // 4. Send PDF. Failure here is logged but not fatal — the booking is
  //    real, the diver can be contacted out-of-band.
  try {
    const base64 = await buildPdfBase64(payload)
    const buf    = Buffer.from(base64, "base64")
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
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
  } catch (e) {
    console.error("PDF email failed:", (e as Error).message)
  }

  return json({ booking_id: booking.id, session })
})
