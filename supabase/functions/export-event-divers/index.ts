// export-event-divers — admin-only PDF manifest of every diver registered
// for a single event, emailed to the company inbox.
//
// Flow:
//   1. Verify caller via Bearer JWT.
//   2. Confirm caller is an admin (profiles.role = 'admin').
//   3. Fetch the EO_dive or EO_course row to pull title + dates.
//   4. Fetch all 'pending' / 'confirmed' bookings for the event (cancelled
//      and waitlisted divers aren't on the manifest — they won't show up).
//   5. Join in profiles for each booking to read name / name_alt /
//      date_of_birth / nationality / id_number.
//   6. Build a PDF via _shared/event-divers-pdf.ts and email it to
//      fundiverstw@gmail.com with the caller BCCed.
//
// Body: { event_type: 'dive' | 'course', event_id: string }
// Returns: 200 { ok: true, diver_count }
//          400 on bad request
//          401/403 on auth or role failure
//          500 on database / email failure

import { createClient } from "jsr:@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.14"
import { Buffer } from "node:buffer"
import { buildEventDiversPdfBase64, type EventDiverRow } from "../_shared/event-divers-pdf.ts"

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)
  const token = auth.slice("Bearer ".length)

  let body: { event_type?: unknown; event_id?: unknown }
  try { body = await req.json() } catch { return json({ error: "invalid json body" }, 400) }
  const eventType = body.event_type
  const eventId   = body.event_id
  if (eventType !== "dive" && eventType !== "course") {
    return json({ error: "event_type must be 'dive' or 'course'" }, 400)
  }
  if (typeof eventId !== "string" || eventId.length === 0) {
    return json({ error: "event_id required" }, 400)
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
  if (profErr) return json({ error: profErr.message }, 500)
  if (callerProfile?.role !== "admin") return json({ error: "admin only" }, 403)

  // Pull the event row.
  const table = eventType === "dive" ? "EO_dives" : "EO_courses"
  const titleCols = "display_title, admin_title, calendar_title"
  const { data: event, error: eErr } = await admin
    .from(table)
    .select(`_id, start_date, end_date, ${titleCols}`)
    .eq("_id", eventId)
    .single()
  if (eErr || !event) return json({ error: eErr?.message ?? "event not found" }, 404)

  // Bookings for this event whose divers are expected to attend.
  const fkCol = eventType === "dive" ? "eo_dive_id" : "eo_course_id"
  const { data: bookings, error: bErr } = await admin
    .from("bookings")
    .select("user_id, status")
    .eq(fkCol, eventId)
    .in("status", ["pending", "confirmed"])
  if (bErr) return json({ error: bErr.message }, 500)

  const userIds = [...new Set((bookings ?? []).map(b => b.user_id as string))]
  let profiles: Array<{
    id: string
    full_name: string | null
    display_name: string | null
    name_alt: string | null
    date_of_birth: string | null
    nationality: string | null
    id_number: string | null
  }> = []
  if (userIds.length > 0) {
    const { data: profs, error: pErr } = await admin
      .from("profiles")
      .select("id, full_name, display_name, name_alt, date_of_birth, nationality, id_number")
      .in("id", userIds)
    if (pErr) return json({ error: pErr.message }, 500)
    profiles = profs ?? []
  }

  // Sort by full_name for a predictable manifest order. Profiles missing
  // a full_name fall back to display_name → '(unnamed)' so they still appear.
  const divers: EventDiverRow[] = profiles
    .map(p => ({
      name:        p.full_name?.trim() || p.display_name?.trim() || "(unnamed)",
      nameAlt:     p.name_alt?.trim() || null,
      dob:         p.date_of_birth ?? null,
      nationality: p.nationality?.trim() || null,
      idNumber:    p.id_number?.trim() || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const eventTitle = (event.display_title || event.admin_title || event.calendar_title || "(untitled event)") as string

  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "email not configured" }, 500)
  }

  let pdfBuffer: Buffer
  try {
    const b64 = await buildEventDiversPdfBase64({
      eventTitle,
      startDate: (event.start_date as string | null) ?? null,
      endDate:   (event.end_date   as string | null) ?? null,
      divers,
    })
    pdfBuffer = Buffer.from(b64, "base64")
  } catch (e) {
    return json({ error: `pdf build failed: ${(e as Error).message}` }, 500)
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    const stamp = (event.start_date as string | null) ?? new Date().toISOString().slice(0, 10)
    const subject  = `manifest--${eventTitle}--${stamp}`
    const filename = `manifest-${stamp}.pdf`
    const text = `Diver manifest for ${eventTitle} (${stamp}). ${divers.length} diver${divers.length === 1 ? "" : "s"} registered.`

    await transporter.sendMail({
      from:    { name: "FunDivers TW", address: GMAIL_USER },
      to:      COMPANY_EMAIL,
      // BCC the requesting admin (if they have an email on file and it's
      // not the company address itself) so they get a copy in their inbox.
      bcc:     callerEmail && callerEmail.toLowerCase() !== COMPANY_EMAIL ? callerEmail : undefined,
      subject,
      text,
      attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
    })
  } catch (e) {
    return json({ error: `email failed: ${(e as Error).message}` }, 500)
  }

  return json({ ok: true, diver_count: divers.length })
})
