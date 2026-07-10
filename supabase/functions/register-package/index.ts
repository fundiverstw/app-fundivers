// register-package — a signed-in diver registers for a partner-shop package.
// Unlike the old "express interest" RPC, this builds a real order: a chosen
// price tier, a preferred date range, add-ons (charged per day) and a room
// (charged per night) from our catalog. It:
//   1. Verifies the caller via Bearer JWT (app users only — no guest path).
//   2. Validates the package is published and the tier/add-ons/room belong to it.
//   3. Recomputes the cost estimate server-side (authoritative — the kickback is
//      keyed on it, so a client-sent total is never trusted).
//   4. Inserts one package_registrations row (service role), snapshotting the
//      estimate + the package's kickback rate. Idempotent against the one-live
//      index: a diver tapping twice gets their existing registration back.
//   5. Emails the partner shop (FROM us, reply-to the diver) and the diver, both
//      carrying the estimate and the "final cost set by the partner shop"
//      disclaimer. Email failure is logged, never fatal — the registration stands.
//
// Body: { package_id, tier_id, preferred_start, preferred_end, addon_ids[], room_id?, notes? }
// Returns: 200 { registration_id, estimated_cost, estimated_currency }
//          400 bad input · 401 bad/absent bearer · 404 package/tier not found

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import {
  parseRegisterPackageInput,
  buildPackageRegistrationEmail,
} from "../_shared/package-registration-email.ts"
import {
  rangeDaysNights,
  buildRegistrationCharges,
  estimateTotal,
  type EstimateItem,
} from "../_shared/registration-estimate.ts"
import { siteConfig } from "../../../fundive.config.ts"

const COMPANY_EMAIL = siteConfig.contact.email

const labelOf = (r: { display_title?: string | null; admin_title?: string | null } | null, fallback: string) =>
  r?.display_title || r?.admin_title || fallback

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
  const diverId = u.user.id
  const diverEmail = u.user.email
  if (!diverEmail) return json({ error: "user has no email on file" }, 400)

  let body: unknown
  try { body = await req.json() } catch { return json({ error: "invalid body" }, 400) }
  const parsed = parseRegisterPackageInput(body as Record<string, unknown>)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  const reqData = parsed.request

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Package must be published; grab the catalog id allow-lists + kickback rate.
  const { data: pkg, error: pErr } = await admin
    .from("packages")
    .select("id, title, status, trusted_partner_id, addon_ids, room_type_ids, kickback_rate")
    .eq("id", reqData.packageId)
    .maybeSingle()
  if (pErr) return json({ error: safeError(pErr, "package lookup failed") }, 500)
  if (!pkg) return json({ error: "package not found" }, 404)
  if (pkg.status !== "published") return json({ error: "package is not open for registration" }, 400)

  // The tier must belong to this package.
  const { data: tier, error: tErr } = await admin
    .from("package_tiers")
    .select("id, name, price, currency, package_id")
    .eq("id", reqData.tierId)
    .maybeSingle()
  if (tErr) return json({ error: safeError(tErr, "tier lookup failed") }, 500)
  if (!tier || tier.package_id !== pkg.id) return json({ error: "tier not found for this package" }, 400)

  // Add-ons / room must be within the package's allowed catalog ids.
  const allowedAddons = new Set<string>(pkg.addon_ids ?? [])
  const allowedRooms = new Set<string>(pkg.room_type_ids ?? [])
  if (reqData.addonIds.some((id) => !allowedAddons.has(id))) {
    return json({ error: "add-on not offered on this package" }, 400)
  }
  if (reqData.roomId && !allowedRooms.has(reqData.roomId)) {
    return json({ error: "room not offered on this package" }, 400)
  }

  // Resolve prices from the catalog (never trust client amounts).
  let addonRows: Array<{ id: string; display_title: string | null; admin_title: string | null; price: number | null }> = []
  if (reqData.addonIds.length) {
    const { data, error } = await admin
      .from("addons").select("id, display_title, admin_title, price").in("id", reqData.addonIds)
    if (error) return json({ error: safeError(error, "add-on lookup failed") }, 500)
    addonRows = data ?? []
  }
  let roomRow: { id: string; display_title: string | null; admin_title: string | null; added_price: number | null } | null = null
  if (reqData.roomId) {
    const { data, error } = await admin
      .from("rooms").select("id, display_title, admin_title, added_price").eq("id", reqData.roomId).maybeSingle()
    if (error) return json({ error: safeError(error, "room lookup failed") }, 500)
    roomRow = data ?? null
  }

  const { days, nights } = rangeDaysNights(reqData.preferredStart, reqData.preferredEnd)
  const addonItems: EstimateItem[] = addonRows.map((a) => ({
    label: labelOf(a, "Add-on"), price: a.price ?? 0,
  }))
  const roomItem: EstimateItem | null = roomRow
    ? { label: labelOf(roomRow, "Room"), price: roomRow.added_price ?? 0 }
    : null
  const charges = buildRegistrationCharges({
    baseLabel: `Package: ${tier.name}`, basePrice: tier.price ?? 0, addons: addonItems, room: roomItem, days, nights,
  })
  const total = estimateTotal(charges)
  const currency = tier.currency ?? siteConfig.locale.currency

  // Insert the registration, snapshotting the estimate + kickback rate. The
  // one-live partial unique index makes a double-tap idempotent.
  const details = {
    tier: { id: tier.id, name: tier.name, price: tier.price ?? 0 },
    days, nights,
    add_ons: reqData.addonIds,
    room: { option_id: reqData.roomId },
    charges, total, currency,
  }
  const insert = {
    package_id: pkg.id,
    tier_id: tier.id,
    diver_id: diverId,
    preferred_start: reqData.preferredStart,
    preferred_end: reqData.preferredEnd,
    estimated_cost: total,
    estimated_currency: currency,
    details,
    notes: reqData.notes || null,
    kickback_rate: pkg.kickback_rate,
  }

  const { data: inserted, error: iErr } = await admin
    .from("package_registrations").insert(insert).select("id").single()
  if (iErr) {
    // 23505 = the one-live unique index: return the diver's existing registration.
    if ((iErr as { code?: string }).code === "23505") {
      const { data: existing } = await admin
        .from("package_registrations")
        .select("id, estimated_cost, estimated_currency")
        .eq("package_id", pkg.id).eq("diver_id", diverId).neq("status", "cancelled")
        .maybeSingle()
      if (existing) {
        return json({
          registration_id: existing.id,
          estimated_cost: existing.estimated_cost,
          estimated_currency: existing.estimated_currency,
          already_registered: true,
          emailed: false,
        })
      }
    }
    return json({ error: safeError(iErr, "could not save registration") }, 500)
  }
  const registrationId = inserted.id

  // Resolve partner + diver name for the emails.
  const { data: partner } = await admin
    .from("trusted_partners").select("name, contact_email, active").eq("id", pkg.trusted_partner_id).maybeSingle()
  const { data: profile } = await admin
    .from("profiles").select("name, nickname").eq("id", diverId).maybeSingle()
  const diverName = [profile?.name, profile?.nickname ? `(${profile.nickname})` : null].filter(Boolean).join(" ")

  let emailed = false
  if (GMAIL_USER && GMAIL_PASS && partner?.active && partner.contact_email) {
    const { partnerSubject, diverSubject, partnerText, diverText } = buildPackageRegistrationEmail({
      shopName: siteConfig.identity.shopName,
      partnerName: partner.name,
      productTitle: pkg.title,
      tierName: tier.name,
      addonLabels: addonItems.map((a) => a.label),
      roomLabel: roomItem?.label ?? null,
      preferredStart: reqData.preferredStart,
      preferredEnd: reqData.preferredEnd,
      nights,
      notes: reqData.notes,
      diverName,
      diverEmail,
      estimateTotal: total,
      currencyLabel: currency,
    })
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      })
      await transporter.sendMail({
        from: { name: siteConfig.identity.shopName, address: GMAIL_USER },
        to: partner.contact_email, cc: COMPANY_EMAIL, replyTo: diverEmail,
        subject: partnerSubject, text: partnerText,
      })
      if (diverEmail.toLowerCase().trim() !== COMPANY_EMAIL.toLowerCase()) {
        await transporter.sendMail({
          from: { name: siteConfig.identity.shopName, address: GMAIL_USER },
          to: diverEmail, subject: diverSubject, text: diverText,
        })
      }
      emailed = true
    } catch (e) {
      // Email is best-effort; the registration already landed.
      console.error("register-package email failed:", (e as Error).message)
    }
  }

  return json({ registration_id: registrationId, estimated_cost: total, estimated_currency: currency, emailed })
})
