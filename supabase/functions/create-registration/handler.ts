// Pure handler for create-registration. The Deno entry (index.ts)
// builds production deps and forwards every request here; tests build
// in-memory deps with vi.fn() mocks. Keeping this file Deno-import-free
// is what lets vitest unit-test it from Node alongside the SPA suite.
//
// All side effects (DB, auth, SMTP, PDF) go through `deps`. The body
// is a verbatim port of the previous Deno.serve handler with three
// changes:
//   1. createClient calls replaced with deps.admin / deps.anon /
//      deps.makeAuthedClient.
//   2. Profile patch sanitized via sanitizeProfilePatch (security
//      audit C2 — was a column-blind spread + status delete).
//   3. nodemailer transporter is optional. When null the email step
//      is skipped silently — useful for tests, and a defense-in-depth
//      switch for deploys where SMTP isn't wired.

import { Buffer } from "node:buffer"
import { sanitizeProfilePatch } from "../_shared/profile-patch.ts"
import { corsHeaders, safeError } from "../_shared/responses.ts"
import type { RegistrationPdfPayload } from "../_shared/pdf.ts"

// Matches RegisterForm.tsx's payment_method enum verbatim.
function paymentWireLabel(m: string | null | undefined): string {
  return m ?? ""
}

// Prefer Cloudflare's authoritative header when fronted by CF
// (which Workers/Pages are); fall through to the next-best-effort
// XFF / X-Real-IP chain. Returns null if nothing usable was sent.
function clientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip")
  if (cf) return cf
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim() || null
  return req.headers.get("x-real-ip")
}

async function sha256Hex(input: string): Promise<string> {
  const bytes  = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

export interface RegistrationBody {
  email?:    string
  password?: string
  agreed_to_terms_at?: string
  agreed_to_terms_version?: number
  target_user_id?: string
  event_type:  'dive' | 'course'
  event_id:    string
  profile_patch: Record<string, unknown>
  details:       Record<string, unknown>
  notes?:        string | null
  group_id?:     string
  // Cloudflare Turnstile token from the SPA widget. Required on the
  // guest path; ignored on auth'd paths (the Bearer token is already
  // proof-of-not-a-bot).
  turnstile_token?: string
}

// 5/min OR 50/day per IP. Tight enough to take down a script in <1
// minute, loose enough that a real person retrying after a typo and
// a "huh, didn't get the email" refresh won't be locked out.
export const RATE_LIMIT_PER_60S = 5
export const RATE_LIMIT_PER_24H = 50

// ----- Narrow interfaces for injected deps. The real supabase-js
//       client conforms structurally; tests pass vi.fn-backed shims.
//       `any` on chain returns is deliberate — modelling the full
//       PostgrestQueryBuilder generic is more pain than value here.

export interface SupabaseAdminClient {
  auth: {
    admin: {
      createUser(opts: {
        email: string
        password: string
        email_confirm?: boolean
        user_metadata?: Record<string, unknown>
      }): Promise<{ data: { user: { id: string; email: string | null } | null }; error: { message: string } | null }>
      getUserById(id: string): Promise<{ data: { user: { id: string; email: string | null } | null }; error: { message: string } | null }>
      deleteUser(id: string): Promise<unknown>
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

export interface SupabaseAuthedClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string; email: string | null } | null }; error: { message: string } | null }>
  }
}

export interface SupabaseAnonClient {
  auth: {
    signInWithPassword(opts: { email: string; password: string }): Promise<{ data: { session: unknown | null } | null; error: { message: string } | null }>
  }
}

export interface Transporter {
  sendMail(msg: {
    from?: { name: string; address: string }
    to: string
    subject: string
    text?: string
    attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }>
  }): Promise<unknown>
}

export interface Env {
  companyEmail:    string
  mailFromName:    string
  mailFromAddress: string
}

export interface TurnstileResult {
  success:    boolean
  errorCodes?: string[]
}

export interface Deps {
  admin:            SupabaseAdminClient
  makeAuthedClient: (token: string) => SupabaseAuthedClient
  anon:             SupabaseAnonClient
  transporter:      Transporter | null
  buildPdfBase64:   (payload: RegistrationPdfPayload) => Promise<string>
  env:              Env
  // Cloudflare Turnstile verifier. Posted token + remote IP go to
  // https://challenges.cloudflare.com/turnstile/v0/siteverify. Tests
  // pass a vi.fn() stub; the real implementation lives in index.ts.
  verifyTurnstile:  (token: string, remoteIp: string | null) => Promise<TurnstileResult>
}

export async function handleRegistration(req: Request, deps: Deps): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  })
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  let body: RegistrationBody
  try { body = await req.json() as RegistrationBody } catch { return json({ error: "invalid json" }, 400) }

  if (!body.event_type || !body.event_id) {
    return json({ error: "event_type and event_id required" }, 400)
  }

  const admin = deps.admin

  // Resolve the user — guest creates, target_user_id acts on behalf, or
  // self-auth via Bearer. createdGuest tracked so we can roll back the
  // auth user if the booking insert later fails.
  let userId: string
  let registrantEmail: string
  let session: unknown = null
  let createdGuest = false

  const auth = req.headers.get("Authorization") ?? ""
  if (auth.startsWith("Bearer ") && body.target_user_id) {
    // On-behalf-of path. Admin (any target) or parent (target must
    // have profiles.parent_account = caller.id).
    const token  = auth.slice("Bearer ".length)
    const caller = deps.makeAuthedClient(token)
    const { data: c, error: cErr } = await caller.auth.getUser()
    if (cErr || !c.user) return json({ error: "invalid bearer" }, 401)

    const { data: callerProfile } = await admin
      .from("profiles").select("role").eq("id", c.user.id).single()
    const isAdmin = callerProfile?.role === "admin"
    if (!isAdmin) {
      const { data: targetProfile } = await admin
        .from("profiles").select("parent_account").eq("id", body.target_user_id).maybeSingle()
      if (!targetProfile || targetProfile.parent_account !== c.user.id) {
        return json({ error: "not authorized to register this diver" }, 403)
      }
    }

    const { data: target, error: tErr } = await admin.auth.admin.getUserById(body.target_user_id)
    if (tErr || !target.user) return json({ error: "target user not found" }, 404)
    userId = target.user.id
    registrantEmail = target.user.email ?? ""
    if (!registrantEmail) return json({ error: "target has no email" }, 400)
  } else if (auth.startsWith("Bearer ") && !body.email) {
    const token  = auth.slice("Bearer ".length)
    const caller = deps.makeAuthedClient(token)
    const { data: u, error: uErr } = await caller.auth.getUser()
    if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)
    userId = u.user.id
    registrantEmail = u.user.email ?? ""
    if (!registrantEmail) return json({ error: "user has no email" }, 400)
  } else {
    if (!body.email || !body.password) {
      return json({ error: "email and password required for guest path" }, 400)
    }
    // Guest path gates (audit H2) — verify Turnstile, rate-limit per
    // IP, confirm the target event actually exists. All three short-
    // circuit BEFORE auth.admin.createUser to avoid burning MAU /
    // sending email when the request is hostile or malformed.
    if (!body.turnstile_token) {
      return json({ error: "captcha token required" }, 400)
    }
    const remoteIp = clientIp(req)
    const turnstile = await deps.verifyTurnstile(body.turnstile_token, remoteIp)
    if (!turnstile.success) {
      return json({ error: "captcha verification failed" }, 403)
    }

    const ipHashHex = await sha256Hex(remoteIp ?? "unknown")
    const { data: counts, error: rlErr } = await admin.rpc("record_signup_attempt", {
      p_ip_hash: `\\x${ipHashHex}`,
    })
    if (rlErr) {
      return json({ error: safeError(rlErr, "rate-limit check failed") }, 500)
    }
    const row = Array.isArray(counts) ? counts[0] : counts
    const in60s = (row?.in_last_60s ?? 0) as number
    const in24h = (row?.in_last_24h ?? 0) as number
    if (in60s > RATE_LIMIT_PER_60S || in24h > RATE_LIMIT_PER_24H) {
      return json({ error: "too many signup attempts, try again later" }, 429)
    }

    // Confirm the event exists in the catalog. Without this, an
    // attacker could spend their per-IP budget on garbage event_ids
    // and still consume MAU + emails.
    const eventTable = body.event_type === "dive" ? "EO_dives" : "EO_courses"
    const { data: existsRow } = await admin
      .from(eventTable).select("_id").eq("_id", body.event_id).maybeSingle()
    if (!existsRow) {
      return json({ error: "event not found" }, 404)
    }

    const { data, error } = await admin.auth.admin.createUser({
      email:         body.email.trim(),
      password:      body.password,
      email_confirm: true,
      user_metadata: body.agreed_to_terms_at
        ? {
            agreed_to_terms_at:      body.agreed_to_terms_at,
            agreed_to_terms_version: body.agreed_to_terms_version,
          }
        : undefined,
    })
    if (error || !data.user) {
      return json({ error: error?.message ?? "createUser failed" }, 400)
    }
    userId = data.user.id
    registrantEmail = body.email.trim()
    createdGuest = true

    const { data: si } = await deps.anon.auth.signInWithPassword({
      email: registrantEmail, password: body.password,
    })
    session = si?.session ?? null
  }

  async function rollback(reason: string): Promise<Response> {
    if (createdGuest) {
      // Best-effort delete. If it fails we still leak an auth.users
      // row — log it to orphan_auth_users so a janitor can reap it.
      // Pre-cascade-trigger this used to leave the row forever
      // undetectable; post 20260603020000 the cascade-down trigger
      // will also fire if a profile delete happens, but the
      // primary cleanup we WANT here is the auth side.
      try {
        const { error } = await admin.auth.admin.deleteUser(userId) as
          { error?: { message: string } | null }
        if (error) {
          await admin.rpc("log_orphan_auth_user", {
            p_user_id: userId,
            p_email:   registrantEmail || null,
            p_reason:  `rollback after: ${reason} | deleteUser: ${error.message}`,
          }).catch(() => { /* log path itself failed; nothing more to do */ })
        }
      } catch (e) {
        await admin.rpc("log_orphan_auth_user", {
          p_user_id: userId,
          p_email:   registrantEmail || null,
          p_reason:  `rollback after: ${reason} | deleteUser threw: ${(e as Error).message}`,
        }).catch(() => { /* log path itself failed; nothing more to do */ })
      }
    }
    return json({ error: reason }, 500)
  }

  // 1. Profile update — column allowlist (security audit C2).
  const safePatch = sanitizeProfilePatch(body.profile_patch)
  if (createdGuest) safePatch.status = "pending"
  const { error: profErr } = await admin
    .from("profiles")
    .update(safePatch)
    .eq("id", userId)
  if (profErr) return rollback(safeError(profErr, "profile update failed"))

  // 2. Booking insert — pre-check for active booking; partial unique
  //    index is the race safety net.
  const fkColumn = body.event_type === "dive" ? "eo_dive_id" : "eo_course_id"
  const { data: existing } = await admin
    .from("bookings")
    .select("id, status")
    .eq("user_id", userId)
    .eq(fkColumn, body.event_id)
    .neq("status", "cancelled")
    .maybeSingle()
  if (existing) {
    return rollback(`This diver already has an active booking for this event (status: ${existing.status}).`)
  }

  const fk = body.event_type === "dive"
    ? { eo_dive_id: body.event_id, eo_course_id: null }
    : { eo_dive_id: null, eo_course_id: body.event_id }
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .insert({
      user_id:  userId,
      status:   "pending",
      notes:    body.notes ?? null,
      details:  body.details,
      group_id: body.group_id ?? null,
      ...fk,
    })
    .select()
    .single()
  if (bErr || !booking) return rollback(safeError(bErr, "booking insert failed"))
  const isWaitlisted = booking.status === "waitlisted"

  // 3. Build PDF payload from data we already have or can fetch.
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
      .select("admin_title, display_title, added_price")
      .eq("_id", roomDetail.option_id)
      .maybeSingle()
    if (r) {
      const label = (r.display_title ?? r.admin_title ?? "Room") as string
      roomBoard = r.added_price != null ? `${label} (+${r.added_price})` : label
    }
  }

  let otherAddons: string[] = []
  if (addOnIds.length) {
    const { data: as } = await admin
      .from("Other_Addons")
      .select("_id, admin_title, display_title")
      .in("_id", addOnIds)
    otherAddons = (as ?? [])
      .map((a: { admin_title?: string | null; display_title?: string | null }) =>
        (a.display_title ?? a.admin_title ?? "") as string)
      .filter((s: string) => s.length > 0)
  }

  const startDate = (event?.start_date ?? null) as string | null
  function shiftDays(yyyyMmDd: string, deltaDays: number): string {
    const d = new Date(yyyyMmDd + "T00:00:00Z")
    d.setUTCDate(d.getUTCDate() + deltaDays)
    return d.toISOString().slice(0, 10)
  }
  const fallbackDeadline = startDate ? shiftDays(startDate, -7) : null
  const fullPaymentDeadline = (event?.full_payment_deadline as string | null) ?? fallbackDeadline

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
    transportIncluded = true
  }

  const titleFallback =
    (event?.display_title as string | null | undefined) ||
    (event?.admin_title as string | null | undefined) ||
    (event?.calendar_title as string | null | undefined) ||
    "Event"

  const payload: RegistrationPdfPayload = {
    eventTitle: titleFallback,
    startDate,
    endDate:    (event?.end_date ?? null) as string | null,
    name:            profile?.full_name ?? "",
    nameAlt:         profile?.name_alt ?? null,
    email:           registrantEmail,
    dob:             profile?.date_of_birth ?? null,
    nationality:     profile?.nationality ?? null,
    idNumber:        profile?.id_number ?? null,
    contactMethod:   profile?.contact_method ?? null,
    contactId:       profile?.contact_id ?? null,
    certLevel:       profile?.cert_level ?? null,
    certOrg:         profile?.cert_agency ?? null,
    diverNitrox:     !!profile?.nitrox_certified,
    diverDeep:       !!(profile as { deep_certified?: boolean })?.deep_certified,
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
    creditCardInvoiceEmail: (details.credit_card_invoice_email as string | null | undefined) ?? null,
    deposit:         (details.deposit as number | null) ?? null,
    total:           (details.total as number | null) ?? null,
    payDepositOnly:  !!details.pay_deposit_only,
    fullPaymentDeadline,
    cancellationPolicyTitle,
    cancellationPolicyText,
    cancelDate,
    cancellationPolicyAckedAt,
  }

  // 4. Email — optional. transporter=null skips entirely.
  if (deps.transporter) {
    try {
      const subjectName = payload.nameAlt
        ? `${payload.name} ${payload.nameAlt}`
        : payload.name
      const fromHeader = { name: deps.env.mailFromName, address: deps.env.mailFromAddress }
      if (isWaitlisted) {
        const subject = `waitlist--${payload.eventTitle}--${subjectName}`
        const companyText =
          `${payload.name} has been added to the waitlist for ${payload.eventTitle}.`
        const diverText =
          `Thanks for signing up — ${payload.eventTitle} is currently full, so we've added you to the waitlist. ` +
          `If a spot opens up, you'll receive a notification with 24 hours to claim it. No payment is needed unless and until that happens.\n\n` +
          `Keep an eye on the FunDivers TW app for waitlist updates and event reminders.\n\n— FunDivers TW`
        await deps.transporter.sendMail({ from: fromHeader, subject, to: deps.env.companyEmail, text: companyText })
        if (registrantEmail.toLowerCase().trim() !== deps.env.companyEmail) {
          await deps.transporter.sendMail({ from: fromHeader, subject, to: registrantEmail, text: diverText })
        }
      } else {
        const base64  = await deps.buildPdfBase64(payload)
        const buf     = Buffer.from(base64, "base64")
        const subject = `registration--${payload.eventTitle}--${subjectName}`
        const attach  = { filename: "registration.pdf", content: buf, contentType: "application/pdf" }
        await deps.transporter.sendMail({
          from: fromHeader, subject, to: deps.env.companyEmail,
          text: "Registration summary attached.",
          attachments: [attach],
        })
        if (registrantEmail.toLowerCase().trim() !== deps.env.companyEmail) {
          await deps.transporter.sendMail({
            from: fromHeader, subject, to: registrantEmail,
            text:
              "Thanks for registering — your registration summary is attached.\n\n" +
              "Once you've sent your payment, please let us know via email, LINE, or WhatsApp so we can confirm receipt — contact details are in the attached PDF. We don't always see bank or PayPal transfers in real time, and a quick heads-up keeps your spot from falling through the cracks.\n\n" +
              "Keep an eye on the FunDivers TW app for updates to your registration status, payment confirmations, and event reminders.\n\n— FunDivers TW",
            attachments: [attach],
          })
        }
      }
    } catch (e) {
      console.error("registration email failed:", (e as Error).message)
    }
  }

  return json({ booking_id: booking.id, status: booking.status, session })
}
