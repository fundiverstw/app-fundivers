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
import { fetchShopContact } from "../_shared/shop-contact.ts"
import { fetchShopLogoDataUrl } from "../_shared/shop-logo.ts"
import { eligibilityError } from "../_shared/registration-eligibility.ts"
import { usesDateEnvelope, usesCourseDays, type EventKind } from "../../../src/lib/event-kinds.ts"
import { computeBookingMoney } from "../_shared/booking-charges.ts"
import { corsHeaders, safeError } from "../_shared/responses.ts"
import { clientIp, sha256Hex } from "../_shared/request-identity.ts"
import { siteConfig } from "../../../fundive.config.ts"
import { t } from "../_shared/i18n.ts"
import type { RegistrationPdfPayload } from "../_shared/pdf.ts"
import type { PaymentMethodDetails } from "../../../src/lib/payment-method-format.ts"

export interface RegistrationBody {
  email?:    string
  password?: string
  agreed_to_terms_at?: string
  agreed_to_terms_version?: number
  target_user_id?: string
  event_type:  EventKind
  event_id:    string
  profile_patch: Record<string, unknown>
  details:       Record<string, unknown>
  notes?:        string | null
  group_id?:     string
  // Set by the client when this booking is one of several submitted
  // together as a group. The per-diver confirmation email is skipped —
  // the client follows up with a single consolidated group summary via
  // send-group-summary, so the group gets one email, not N.
  suppress_email?: boolean
  // The lead booker paying for this booking, when the group opted into a
  // single payer. Must be the registrant themselves or the authenticated
  // caller (a parent registering a child). Ignored on the guest path. The
  // DB trigger (20260622000000) is the authoritative guard.
  payer_id?:     string
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
//       `any` on chain returns is deliberate — modeling the full
//       PostgrestQueryBuilder generic is more pain than value here.

export interface SupabaseAdminClient {
  auth: {
    admin: {
      createUser(opts: {
        email: string
        password: string
        email_confirm?: boolean
        user_metadata?: Record<string, unknown>
      }): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: { message: string } | null }>
      getUserById(id: string): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: { message: string } | null }>
      deleteUser(id: string): Promise<unknown>
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
  // PromiseLike, not Promise: supabase-js returns a thenable query builder
  // here, which an await resolves but which is not a Promise instance.
  rpc(
    fn: string, args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export interface SupabaseAuthedClient {
  auth: {
    getUser(): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: { message: string } | null }>
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

/**
 * True when the target event's last day is before today (Asia/Taipei). The
 * events date columns are 'YYYY-MM-DD' Taipei calendar days, so a lexical
 * compare is correct. Used to reject diver/guest registrations for events that
 * already happened; admins/staff bypass this server-side check too.
 */
/**
 * The shop's payment method for the key the diver chose. Read server-side for
 * two reasons: the surcharge must be the shop's published rate rather than
 * anything the client asserted, and the PDF's "How to pay" block prints the
 * bank details straight off this row. Null for a key that no longer resolves —
 * the money math then charges no surcharge and the PDF omits the block.
 */
async function loadPaymentMethod(
  admin: SupabaseAdminClient, key: string | null | undefined,
): Promise<PaymentMethodDetails | null> {
  if (!key) return null
  const { data } = await admin
    .from("payment_methods").select("*").eq("key", key).maybeSingle()
  return (data ?? null) as PaymentMethodDetails | null
}

async function eventHasPassed(admin: SupabaseAdminClient, eventType: EventKind, eventId: string): Promise<boolean> {
  const cols  = usesDateEnvelope(eventType) ? "start_date, end_date" : "course_days"
  const { data } = await admin.from("events").select(cols).eq("id", eventId).maybeSingle()
  if (!data) return false // unknown event — existing existence checks handle it
  let lastDay: string | null
  if (usesDateEnvelope(eventType)) {
    lastDay = (data.end_date ?? data.start_date) ?? null
  } else {
    const days = [...((data.course_days ?? []) as string[])].filter(Boolean).sort()
    lastDay = days.length ? days[days.length - 1] : null
  }
  if (!lastDay) return false
  const todayTaipei = new Date().toLocaleDateString("en-CA", { timeZone: siteConfig.locale.timezone })
  return String(lastDay).slice(0, 10) < todayTaipei
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
  // The authenticated caller's id (parent/admin/self), used to authorize a
  // lead-payer designation. Null on the guest path.
  let callerId: string | null = null
  // Admins/staff may book past events (recording after the fact); divers,
  // parents and guests may not. Defaults false; set true only for the
  // privileged auth paths below.
  let callerIsPrivileged = false

  const auth = req.headers.get("Authorization") ?? ""
  if (auth.startsWith("Bearer ") && body.target_user_id) {
    // On-behalf-of path. Admin (any target) or parent (target must
    // have profiles.parent_account = caller.id).
    const token  = auth.slice("Bearer ".length)
    const caller = deps.makeAuthedClient(token)
    const { data: c, error: cErr } = await caller.auth.getUser()
    if (cErr || !c.user) return json({ error: "invalid bearer" }, 401)
    callerId = c.user.id

    const { data: callerProfile } = await admin
      .from("profiles").select("role").eq("id", c.user.id).single()
    const isAdmin = callerProfile?.role === "admin"
    // Admin/staff acting on behalf may book past events; a parent may not.
    callerIsPrivileged = isAdmin || callerProfile?.role === "staff"
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
    callerId = u.user.id
    registrantEmail = u.user.email ?? ""
    if (!registrantEmail) return json({ error: "user has no email" }, 400)
    const { data: selfProfile } = await admin
      .from("profiles").select("role").eq("id", u.user.id).single()
    callerIsPrivileged = selfProfile?.role === "admin" || selfProfile?.role === "staff"
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
    const { data: existsRow } = await admin
      .from("events").select("id").eq("id", body.event_id).maybeSingle()
    if (!existsRow) {
      return json({ error: "event not found" }, 404)
    }

    // Guests can never book a past event — reject before burning a MAU on
    // createUser.
    if (await eventHasPassed(admin, body.event_type, body.event_id)) {
      return json({ error: t.emails.errors.registrationClosed }, 403)
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

  async function rollback(reason: string, status = 500): Promise<Response> {
    if (createdGuest) {
      // Best-effort delete. If it fails we still leak an auth.users
      // row — log it to orphan_auth_users so a janitor can reap it.
      // Pre-cascade-trigger this used to leave the row forever
      // undetectable; post 20260603020000 the cascade-down trigger
      // will also fire if a profile delete happens, but the
      // primary cleanup we WANT here is the auth side.
      // Swallows its own failure: supabase-js's query builder is a thenable
      // with a `then` and NO `catch`, so the `.catch()` this used to chain threw
      // a TypeError out of rollback() — turning a clean error response plus an
      // orphan-log row into an opaque runtime 500 with nothing logged, in
      // exactly the double-failure case the logging exists for.
      const logOrphan = async (why: string) => {
        try {
          await admin.rpc("log_orphan_auth_user", {
            p_user_id: userId,
            p_email:   registrantEmail || null,
            p_reason:  `rollback after: ${reason} | ${why}`,
          })
        } catch { /* log path itself failed; nothing more to do */ }
      }
      try {
        const { error } = await admin.auth.admin.deleteUser(userId) as
          { error?: { message: string } | null }
        if (error) await logOrphan(`deleteUser: ${error.message}`)
      } catch (e) {
        await logOrphan(`deleteUser threw: ${(e as Error).message}`)
      }
    }
    return json({ error: reason }, status)
  }

  // Reads the effective (post-patch) profile + event prereqs and defers to the
  // shared eligibilityError rules. Returns a user-facing message or null.
  async function checkEligibility(uid: string): Promise<string | null> {
    const { data: prof } = await admin
      .from("profiles")
      .select("uncertified, logged_dives")
      .eq("id", uid)
      .single()
    const { data: ev } = await admin
      .from("events")
      .select("prereq_cert_id, req_dives")
      .eq("id", body.event_id)
      .maybeSingle()
    return eligibilityError(
      prof as { uncertified: boolean | null; logged_dives: number | null } | null,
      ev as { prereq_cert_id: string | null; req_dives: number | string | null } | null,
      body.details as Record<string, unknown> | undefined,
    )
  }

  // 1. Profile update — column allowlist (security audit C2).
  const safePatch = sanitizeProfilePatch(body.profile_patch)
  if (createdGuest) safePatch.status = "pending"
  const { error: profErr } = await admin
    .from("profiles")
    .update(safePatch)
    .eq("id", userId)
  if (profErr) return rollback(safeError(profErr, "profile update failed"))

  // Past-event guard for the authed self + parent-on-behalf paths (the guest
  // path already checked before createUser). Admins/staff bypass.
  if (!callerIsPrivileged && await eventHasPassed(admin, body.event_type, body.event_id)) {
    return json({ error: t.emails.errors.registrationClosed }, 403)
  }

  // 1b. Eligibility gate — a diver registering themselves (or via guest) must
  //     have declared a certification (level or uncertified) and acknowledged
  //     any event prerequisite they don't meet on their own profile. Mirrors
  //     the form gates so a crafted request can't slip past them. On-behalf-of
  //     bookings (target_user_id) relax the same way the form does.
  if (!body.target_user_id) {
    const gate = await checkEligibility(userId)
    if (gate) return rollback(gate, 422)
  }

  // 1c. Recompute the booking's money server-side and overwrite the client's
  //     figures. details.total is the amount owed (read by apply_credit_to_booking
  //     and record_group_payment) and details.deposit is the confirm-on-deposit
  //     threshold, so a crafted request must not be able to set its own total.
  //     Selections (gear/room/add-ons/transport) are trusted as intent; every
  //     price behind them comes from the catalog, never the request body.
  {
    const d = body.details as Record<string, unknown>
    const { data: evMoney } = await admin
      .from("events").select("price, dive_days, has_transport, gear_included").eq("id", body.event_id).maybeSingle()

    // An event the shop drives nobody to puts no ride question, so a request
    // that answers one is answering a question that was never asked. Force it
    // off rather than trusting the body: a stray true would put the diver in
    // the Needs-ride bucket on a course that never leaves the shop, and could
    // bill them the transport surcharge for a van that isn't going anywhere.
    if ((evMoney as { has_transport?: boolean } | null)?.has_transport === false) {
      d.transportation = false
    }

    let base = 0, depositAmount = 0, transportPrice = 0
    const priceId = (evMoney?.price as string | null | undefined) ?? null
    if (priceId) {
      const { data: pr } = await admin
        .from("prices").select("starting_at, deposit_amount, transport").eq("id", priceId).maybeSingle()
      base = (pr?.starting_at as number | null) ?? 0
      depositAmount = (pr?.deposit_amount as number | null) ?? 0
      transportPrice = (pr?.transport as number | null) ?? 0
    }

    const roomOpt = (d.room as { option_id?: string } | undefined)?.option_id ?? null
    let roomAddedPrice = 0
    if (roomOpt) {
      const { data: r } = await admin.from("rooms").select("added_price").eq("id", roomOpt).maybeSingle()
      roomAddedPrice = (r?.added_price as number | null) ?? 0
    }

    const addOnIds = Array.isArray(d.add_ons) ? (d.add_ons as string[]) : []
    let addonsTotal = 0
    if (addOnIds.length) {
      const { data: rows } = await admin.from("addons").select("price").in("id", addOnIds)
      addonsTotal = (rows ?? []).reduce(
        (s: number, a: { price: number | null }) => s + (a.price ?? 0), 0)
    }

    // The surcharge is the shop's, never the client's: read it off the
    // payment_methods row the diver named. An unknown key carries none.
    const chosenMethod = await loadPaymentMethod(admin, d.payment_method as string | null | undefined)

    // An event that includes gear (or needs none) puts no gear question, so a
    // request that answers one is answering a question that was never asked.
    // Overwrite rather than trust the body, exactly as the ride answer above:
    // a crafted `gear.rent` with items would otherwise bill a diver for a set
    // the course fee already covers, and put that set on the packing list twice.
    if ((evMoney as { gear_included?: boolean } | null)?.gear_included === true) {
      d.gear = { rent: false, included: true }
    }

    const gear = d.gear as { rent?: boolean; items?: string[] } | undefined
    const money = computeBookingMoney({
      base,
      diveDays: (evMoney?.dive_days as number | null) ?? 1,
      depositAmount,
      transportPrice,
      gearItems: gear?.rent ? (gear.items ?? []) : [],
      gearPrices: siteConfig.business.gearPrices,
      surchargeRate: Number(chosenMethod?.surcharge_percent ?? 0) / 100,
      roomAddedPrice,
      addonsTotal,
      needsTransport: d.transportation === true,
      nitroxCourse: !!d.nitrox_course_addon,
      nitroxCourseFee: siteConfig.business.nitroxCourseFee,
      payDepositOnly: !!d.pay_deposit_only,
    })
    body.details = { ...d, total: money.total, deposit: money.deposit }
  }

  // 2. Booking insert — pre-check for active booking; partial unique
  //    index is the race safety net.
  const { data: existing } = await admin
    .from("bookings")
    .select("id, status")
    .eq("user_id", userId)
    .eq("event_id", body.event_id)
    .neq("status", "cancelled")
    .maybeSingle()
  if (existing) {
    return rollback(t.emails.errors.alreadyBooked(existing.status))
  }

  // A group is whatever set of bookings shares a client-generated group_id, and
  // send-group-summary authorizes on exactly that: hold a booking in the group
  // and you may pull the group's PDF, which carries every member's name, date
  // of birth, nationality and certification. That made group_id a capability
  // token by accident rather than by design — unguessable today only because
  // the client mints it with crypto.randomUUID().
  //
  // So joining is no longer self-service. Every booking already in the group
  // must belong to the caller or to a child they manage, which is exactly what
  // a legitimate group is: one person registering themselves, their children,
  // or themselves across several events. A stranger who learns a group_id now
  // cannot attach to it.
  if (body.group_id) {
    const { data: siblings, error: sibErr } = await admin
      .from("bookings")
      .select("user_id")
      .eq("group_id", body.group_id)
    if (sibErr) return rollback(safeError(sibErr, "group check failed"))
    const otherIds = [...new Set(((siblings ?? []) as Array<{ user_id: string }>)
      .map(s => s.user_id)
      .filter(id => id !== userId && id !== callerId))]
    if (otherIds.length > 0) {
      const controller = callerId ?? userId
      const { data: kin } = await admin
        .from("profiles")
        .select("id")
        .in("id", otherIds)
        .eq("parent_account", controller)
      const managed = new Set(((kin ?? []) as Array<{ id: string }>).map(k => k.id))
      if (otherIds.some(id => !managed.has(id))) {
        return rollback("this group belongs to someone else", 403)
      }
    }
  }

  const fk = { event_id: body.event_id }
  // A lead-payer designation is only honoured when it names the registrant
  // themselves or the authenticated caller (a parent paying for a child).
  // Anything else is dropped; the DB trigger rejects an invalid payer too.
  const payerId =
    body.payer_id && (body.payer_id === userId || body.payer_id === callerId)
      ? body.payer_id
      : null
  const { data: booking, error: bErr } = await admin
    .from("bookings")
    .insert({
      user_id:  userId,
      status:   "pending",
      notes:    body.notes ?? null,
      details:  body.details,
      group_id: body.group_id ?? null,
      payer_id: payerId,
      // Who is doing the registering. This runs as service_role, where the
      // stamping trigger has no auth.uid() to read, so the value it takes is
      // the one resolved above from a verified Bearer token — never anything
      // the client sent. Null on the guest path: the registrant had no account
      // until this request created one.
      created_by: callerId,
      ...fk,
    })
    .select()
    .single()
  if (bErr || !booking) return rollback(safeError(bErr, "booking insert failed"))
  const isWaitlisted = booking.status === "waitlisted"

  // 3. Build PDF payload from data we already have or can fetch.
  const { data: profile } = await admin.from("profiles").select("*").eq("id", userId).single()

  const { data: eventData } = await admin.from("events").select("*").eq("id", body.event_id).maybeSingle()
  const event = eventData as Record<string, unknown> | null

  const details = body.details as Record<string, unknown>
  const roomDetail = details.room as { option_id?: string; notes?: string } | undefined
  const addOnIds   = Array.isArray(details.add_ons) ? details.add_ons as string[] : []
  const gearDetail = details.gear as { rent?: boolean; included?: boolean; items?: string[]; assistance_note?: string } | undefined

  let roomBoard: string | null = null
  if (roomDetail?.option_id) {
    const { data: r } = await admin
      .from("rooms")
      .select("admin_title, display_title, added_price")
      .eq("id", roomDetail.option_id)
      .maybeSingle()
    if (r) {
      const label = (r.display_title ?? r.admin_title ?? "Room") as string
      roomBoard = r.added_price != null ? `${label} (+${r.added_price})` : label
    }
  }

  let otherAddons: string[] = []
  if (addOnIds.length) {
    const { data: as } = await admin
      .from("addons")
      .select("id, admin_title, display_title")
      .in("id", addOnIds)
    otherAddons = (as ?? [])
      .map((a: { admin_title?: string | null; display_title?: string | null }) =>
        (a.display_title ?? a.admin_title ?? "") as string)
      .filter((s: string) => s.length > 0)
  }

  // Dives carry start_date/end_date; courses derive both from course_days.
  const courseDays = [...((event?.course_days ?? []) as string[])].filter(Boolean).sort()
  const startDate = (usesCourseDays(body.event_type)
    ? (courseDays[0] ?? null)
    : (event?.start_date ?? null)) as string | null
  const endDate = (usesCourseDays(body.event_type)
    ? (courseDays[courseDays.length - 1] ?? null)
    : (event?.end_date ?? null)) as string | null
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
      .select("title, cancellation_policy")
      .eq("id", policyId)
      .maybeSingle()
    if (pol) {
      cancellationPolicyTitle = (pol.title ?? null) as string | null
      cancellationPolicyText  = (pol.cancellation_policy ?? null) as string | null
    }
  }
  const cancelDate = (event?.cancel_date as string | null) ?? null
  const cancellationPolicyAckedAt = (details.cancellation_policy_acked_at as string | null) ?? null

  let transportIncluded: boolean
  const priceId = event?.price as string | null | undefined
  if (priceId) {
    const { data: pr } = await admin
      .from("prices")
      .select("transport")
      .eq("id", priceId)
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
    endDate,
    name:            profile?.name ?? "",
    nickname:        profile?.nickname ?? null,
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
    gearItems:       gearDetail?.items ?? [],
    gearAssistanceNote: gearDetail?.assistance_note ?? null,
    diveDays:        (event?.dive_days as number | null) ?? 1,
    height:          profile?.height_cm ?? null,
    weight:          profile?.weight_kg ?? null,
    shoeSize:        profile?.shoe_size ?? null,
    needsRide:       !!details.transportation,
    transportIncluded,
    notes:           booking.notes ?? null,
    shop:            await fetchShopContact(admin),
    logoDataUrl:     await fetchShopLogoDataUrl(admin),
    paymentMethod:   await loadPaymentMethod(admin, details.payment_method as string | null | undefined),
    creditCardInvoiceEmail: (details.credit_card_invoice_email as string | null | undefined) ?? null,
    deposit:         (details.deposit as number | null) ?? null,
    total:           (details.total as number | null) ?? null,
    creditApplied:   (details.credit_applied as number | null) ?? null,
    charges:         Array.isArray(details.charges)
      ? (details.charges as Array<{ label: string; amount: number }>)
      : null,
    payDepositOnly:  !!details.pay_deposit_only,
    fullPaymentDeadline,
    cancellationPolicyTitle,
    cancellationPolicyText,
    cancelDate,
    cancellationPolicyAckedAt,
  }

  // 4. Email — optional. transporter=null skips entirely; suppress_email
  //    skips for grouped bookings (a single group summary is sent instead).
  if (deps.transporter && !body.suppress_email) {
    try {
      // A diver may register without ever typing a name. The email address is
      // the one identifier every registration has, so it stands in — an empty
      // subject line names nobody, and the shop has to know who booked.
      const m = t.emails.registration
      const displayName = payload.name.trim() || registrantEmail
      const subjectName = payload.nickname
        ? `${displayName} (${payload.nickname})`
        : displayName
      const fromHeader = { name: deps.env.mailFromName, address: deps.env.mailFromAddress }
      if (isWaitlisted) {
        const subject = `waitlist--${payload.eventTitle}--${subjectName}`
        const companyText = m.shopWaitlisted(displayName, payload.eventTitle)
        const diverText = [
          m.diverWaitlisted(payload.eventTitle),
          '',
          m.diverWaitlistWatch(siteConfig.identity.shopName),
          '',
          m.signoff(siteConfig.identity.shopName),
        ].join('\n')
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
          text: m.shopSummaryAttached,
          attachments: [attach],
        })
        if (registrantEmail.toLowerCase().trim() !== deps.env.companyEmail) {
          await deps.transporter.sendMail({
            from: fromHeader, subject, to: registrantEmail,
            text: [
              m.diverThanks,
              '',
              m.diverConfirmPayment,
              '',
              m.diverWatchApp(siteConfig.identity.shopName),
              '',
              m.signoff(siteConfig.identity.shopName),
            ].join('\n'),
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
