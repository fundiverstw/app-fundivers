// register-scheduled-trip — a signed-in diver registers for one of the shop's
// own Scheduled Trips. Builds a real order (add-ons per day + a room per night,
// over the trip's fixed dates) and produces a cost ESTIMATE — no booking/payment;
// the shop confirms the final cost offline. Mirrors register-package minus the
// tier/partner/kickback. It:
//   1. Verifies the caller via Bearer JWT (app users only).
//   2. Validates the trip is published and the add-ons/room belong to it.
//   3. Recomputes the estimate server-side (price + add-ons×days + room×nights,
//      days/nights from the trip's fixed dates).
//   4. Inserts one scheduled_trip_registrations row (idempotent on the one-live
//      index; returns already_registered).
//   5. Emails the shop + the diver (reply-to the diver) with the estimate.
//      Email failure is logged, never fatal.
//
// Body: { scheduled_trip_id, addon_ids[], room_id?, notes? }
// Returns: 200 { registration_id, estimated_cost, estimated_currency, emailed }
//          400 bad input · 401 bad/absent bearer · 404 trip not found

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import {
  parseRegisterScheduledTripInput,
  buildScheduledTripRegistrationEmail,
} from "../_shared/scheduled-trip-registration-email.ts"
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
  const parsed = parseRegisterScheduledTripInput(body as Record<string, unknown>)
  if ("error" in parsed) return json({ error: parsed.error }, 400)
  const reqData = parsed.request

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Trip must be published; grab its price/dates + catalog allow-lists.
  const { data: trip, error: tErr } = await admin
    .from("scheduled_trips")
    .select("id, title, status, start_date, end_date, price, currency, addon_ids, room_type_ids")
    .eq("id", reqData.scheduledTripId)
    .maybeSingle()
  if (tErr) return json({ error: safeError(tErr, "trip lookup failed") }, 500)
  if (!trip) return json({ error: "trip not found" }, 404)
  if (trip.status !== "published") return json({ error: "trip is not open for registration" }, 400)

  const allowedAddons = new Set<string>(trip.addon_ids ?? [])
  const allowedRooms = new Set<string>(trip.room_type_ids ?? [])
  if (reqData.addonIds.some((id) => !allowedAddons.has(id))) {
    return json({ error: "add-on not offered on this trip" }, 400)
  }
  if (reqData.roomId && !allowedRooms.has(reqData.roomId)) {
    return json({ error: "room not offered on this trip" }, 400)
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

  const { days, nights } = rangeDaysNights(trip.start_date, trip.end_date)
  const addonItems: EstimateItem[] = addonRows.map((a) => ({ label: labelOf(a, "Add-on"), price: a.price ?? 0 }))
  const roomItem: EstimateItem | null = roomRow
    ? { label: labelOf(roomRow, "Room"), price: roomRow.added_price ?? 0 }
    : null
  const charges = buildRegistrationCharges({
    baseLabel: "Trip", basePrice: trip.price ?? 0, addons: addonItems, room: roomItem, days, nights,
  })
  const total = estimateTotal(charges)
  const currency = trip.currency ?? siteConfig.locale.currency

  const details = {
    days, nights,
    add_ons: reqData.addonIds,
    room: { option_id: reqData.roomId },
    charges, total, currency,
  }
  const insert = {
    scheduled_trip_id: trip.id,
    diver_id: diverId,
    estimated_cost: total,
    estimated_currency: currency,
    details,
    notes: reqData.notes || null,
  }

  const { data: inserted, error: iErr } = await admin
    .from("scheduled_trip_registrations").insert(insert).select("id").single()
  if (iErr) {
    // 23505 = the one-live unique index: return the diver's existing registration.
    if ((iErr as { code?: string }).code === "23505") {
      const { data: existing } = await admin
        .from("scheduled_trip_registrations")
        .select("id, estimated_cost, estimated_currency")
        .eq("scheduled_trip_id", trip.id).eq("diver_id", diverId).neq("status", "cancelled")
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

  const { data: profile } = await admin
    .from("profiles").select("name, nickname").eq("id", diverId).maybeSingle()
  const diverName = [profile?.name, profile?.nickname ? `(${profile.nickname})` : null].filter(Boolean).join(" ")
  const tripDates = trip.start_date
    ? (trip.end_date && trip.end_date !== trip.start_date ? `${trip.start_date} to ${trip.end_date}` : trip.start_date)
    : null

  let emailed = false
  if (GMAIL_USER && GMAIL_PASS) {
    const { subject, shopText, diverText } = buildScheduledTripRegistrationEmail({
      shopName: siteConfig.identity.shopName,
      tripTitle: trip.title,
      tripDates,
      addonLabels: addonItems.map((a) => a.label),
      roomLabel: roomItem?.label ?? null,
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
        to: COMPANY_EMAIL, replyTo: diverEmail, subject, text: shopText,
      })
      if (diverEmail.toLowerCase().trim() !== COMPANY_EMAIL.toLowerCase()) {
        await transporter.sendMail({
          from: { name: siteConfig.identity.shopName, address: GMAIL_USER },
          to: diverEmail, subject, text: diverText,
        })
      }
      emailed = true
    } catch (e) {
      console.error("register-scheduled-trip email failed:", (e as Error).message)
    }
  }

  return json({ registration_id: registrationId, estimated_cost: total, estimated_currency: currency, emailed })
})
