// export-event-divers — admin-only boat-manifest (.xlsx) of every diver
// registered for a single event, emailed to the company inbox.
//
// The sheet matches the Taiwanese recreational-fishing-vessel passenger
// form (娛樂漁業漁船出海人員名冊). XLSX is Unicode-native, so the Chinese
// headers / names / values need no font embedding.
//
// Flow:
//   1. Verify caller via Bearer JWT.
//   2. Confirm caller is an admin (profiles.role = 'admin').
//   3. Fetch the EO_dive or EO_course row to pull title + dates.
//   4. Fetch all 'pending' / 'confirmed' bookings for the event (cancelled
//      and waitlisted divers aren't on the manifest — they won't show up).
//   5. Join in profiles for each booking to read name (legal, as on ID) /
//      date_of_birth / nationality / id_number / gender / cert_level /
//      logged_dives.
//   6. Fetch the duties for the event and append the staff on board
//      (instructors / guides / support), deduped by person, with their role
//      noted in the 備註 column. Anyone already booked as a diver is skipped.
//   7. Build an .xlsx via _shared/event-divers-xlsx.ts and email it to
//      fundiverstw@gmail.com with the caller BCCed.
//
// Body: { event_type: 'dive' | 'course', event_id: string,
//         boat?: { boat_name?: string, registration?: string, notes?: string[] } }
// Returns: 200 { ok: true, diver_count }
//          400 on bad request
//          401/403 on auth or role failure
//          500 on database / email failure

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { Buffer } from "node:buffer"
import { buildEventDiversXlsxBase64, type EventDiverRow } from "../_shared/event-divers-xlsx.ts"
import { roleToZh } from "../_shared/event-divers-manifest.ts"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import { siteConfig } from "../../../fundive.config.ts"

// Profile columns the manifest reads, shared by the booked-diver and
// on-duty-staff fetches.
const PROFILE_COLS =
  "id, name, date_of_birth, nationality, id_number, gender, cert_level, logged_dives"

interface ManifestProfile {
  id: string
  name: string | null
  date_of_birth: string | null
  nationality: string | null
  id_number: string | null
  gender: string | null
  cert_level: string | null
  logged_dives: number | null
}

// Map a profile row to a manifest line. The 姓名 column is the legal name
// exactly as on the diver's ID. `remark` flags a staffer's role (教練 etc.);
// booked divers pass null and leave the 備註 cell blank.
function toManifestRow(p: ManifestProfile, remark: string | null = null): EventDiverRow {
  return {
    name:        p.name?.trim() || "(unnamed)",
    dob:         p.date_of_birth ?? null,
    nationality: p.nationality?.trim() || null,
    idNumber:    p.id_number?.trim() || null,
    gender:      p.gender?.trim() || null,
    certLevel:   p.cert_level?.trim() || null,
    loggedDives: p.logged_dives ?? null,
    remark,
  }
}

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const COMPANY_EMAIL = siteConfig.contact.email

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

  let body: { event_type?: unknown; event_id?: unknown; boat?: unknown }
  try { body = await req.json() } catch { return json({ error: "invalid json body" }, 400) }
  const eventType = body.event_type
  const eventId   = body.event_id
  if (eventType !== "dive" && eventType !== "course") {
    return json({ error: "event_type must be 'dive' or 'course'" }, 400)
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    return json({ error: "event_id required" }, 400)
  }

  // Boat header / footer notes are admin-supplied per export (the chartered
  // vessel varies by trip). All fields optional — the builder degrades to
  // just the form title + diver table when they're absent.
  const boatRaw = (body.boat ?? {}) as { boat_name?: unknown; registration?: unknown; notes?: unknown }
  const boat = {
    boatName:     typeof boatRaw.boat_name === "string" ? boatRaw.boat_name : "",
    registration: typeof boatRaw.registration === "string" ? boatRaw.registration : "",
    notes:        Array.isArray(boatRaw.notes) ? boatRaw.notes.filter((n): n is string => typeof n === "string") : [],
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const callerEmail = u.user.email ?? null
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Role check — admin only. Staff and divers can't trigger this.
  const { data: callerProfile, error: profErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", u.user.id)
    .single()
  if (profErr) return json({ error: safeError(profErr, "profile fetch failed") }, 500)
  if (callerProfile?.role !== "admin") return json({ error: "admin only" }, 403)

  // Pull the event row. Dives carry a start_date/end_date envelope;
  // courses only carry course_days, so the manifest's date stamp comes
  // from the earliest course day instead.
  const table = eventType === "dive" ? "EO_dives" : "EO_courses"
  const titleCols = "display_title, admin_title, calendar_title"
  const dateCols = eventType === "dive" ? "start_date, end_date" : "course_days"
  const { data: event, error: eErr } = await admin
    .from(table)
    .select(`_id, ${dateCols}, ${titleCols}`)
    .eq("_id", eventId)
    .single()
  if (eErr || !event) return json({ error: safeError(eErr, "event not found") }, 404)

  // Earliest date the event runs on, used only for the email subject /
  // filename stamp.
  const eventStartDate = eventType === "dive"
    ? (event.start_date as string | null)
    : ([...((event.course_days as string[] | null) ?? [])].sort()[0] ?? null)

  // Bookings for this event whose divers are expected to attend.
  const fkCol = eventType === "dive" ? "eo_dive_id" : "eo_course_id"
  const { data: bookings, error: bErr } = await admin
    .from("bookings")
    .select("user_id, status")
    .eq(fkCol, eventId)
    .in("status", ["pending", "confirmed"])
  if (bErr) return json({ error: safeError(bErr, "bookings fetch failed") }, 500)

  const userIds = [...new Set((bookings ?? []).map(b => b.user_id as string))]
  let profiles: ManifestProfile[] = []
  if (userIds.length > 0) {
    const { data: profs, error: pErr } = await admin
      .from("profiles")
      .select(PROFILE_COLS)
      .in("id", userIds)
    if (pErr) return json({ error: safeError(pErr, "profiles fetch failed") }, 500)
    profiles = (profs ?? []) as ManifestProfile[]
  }

  // Sort by name for a predictable manifest order. Profiles missing
  // a name fall back to nickname → '(unnamed)' so they still appear.
  const divers: EventDiverRow[] = profiles
    .map(p => toManifestRow(p))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Staff on duty for this event also board the boat, so they belong on the
  // manifest. A staffer may hold several duty rows (one per course day) and
  // cover more than one role — dedupe by person, collecting distinct roles.
  // The duty FK column matches the booking FK column (eo_dive_id / eo_course_id).
  const { data: dutyRows, error: dErr } = await admin
    .from("duties")
    .select("assignee_id, role")
    .eq(fkCol, eventId)
  if (dErr) return json({ error: safeError(dErr, "duties fetch failed") }, 500)

  // Don't list anyone twice: a person already on the diver manifest (a booked
  // diver) is skipped here even if they also hold a duty for the event.
  const diverIdSet = new Set(userIds)
  const rolesByStaff = new Map<string, Set<string>>()
  for (const d of dutyRows ?? []) {
    const id = d.assignee_id as string | null
    if (!id || diverIdSet.has(id)) continue
    let roles = rolesByStaff.get(id)
    if (!roles) { roles = new Set(); rolesByStaff.set(id, roles) }
    if (d.role) roles.add(d.role as string)
  }

  let staff: EventDiverRow[] = []
  if (rolesByStaff.size > 0) {
    const { data: staffProfs, error: spErr } = await admin
      .from("profiles")
      .select(PROFILE_COLS)
      .in("id", [...rolesByStaff.keys()])
    if (spErr) return json({ error: safeError(spErr, "staff profiles fetch failed") }, 500)
    staff = ((staffProfs ?? []) as ManifestProfile[])
      .map(p => toManifestRow(
        p,
        [...(rolesByStaff.get(p.id) ?? [])].map(roleToZh).join("、"),
      ))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  // Divers first (numbered), then staff — one continuous "people aboard" list.
  const manifestRows = [...divers, ...staff]

  const eventTitle = (event.display_title || event.admin_title || event.calendar_title || "(untitled event)") as string

  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "email not configured" }, 500)
  }

  let xlsxBuffer: Buffer
  try {
    const b64 = buildEventDiversXlsxBase64({ divers: manifestRows, config: boat })
    xlsxBuffer = Buffer.from(b64, "base64")
  } catch (e) {
    return json({ error: `xlsx build failed: ${(e as Error).message}` }, 500)
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    const stamp = eventStartDate ?? new Date().toISOString().slice(0, 10)
    const subject  = `manifest--${eventTitle}--${stamp}`
    const filename = `manifest-${stamp}.xlsx`
    const staffPart = staff.length ? ` + ${staff.length} staff` : ""
    const text = `Boat manifest for ${eventTitle} (${stamp}). ${divers.length} diver${divers.length === 1 ? "" : "s"}${staffPart}.`

    await transporter.sendMail({
      from:    { name: siteConfig.identity.shopName, address: GMAIL_USER },
      to:      COMPANY_EMAIL,
      // BCC the requesting admin (if they have an email on file and it's
      // not the company address itself) so they get a copy in their inbox.
      bcc:     callerEmail && callerEmail.toLowerCase() !== COMPANY_EMAIL ? callerEmail : undefined,
      subject,
      text,
      attachments: [{ filename, content: xlsxBuffer, contentType: XLSX_CONTENT_TYPE }],
    })
  } catch (e) {
    return json({ error: `email failed: ${(e as Error).message}` }, 500)
  }

  return json({ ok: true, diver_count: divers.length, staff_count: staff.length })
})
