// request-dive-log-export — emails the diver a CSV of all their dive_logs.
//
// Flow:
//   1. Verify caller via Bearer JWT.
//   2. Check `dive_log_export_requests` for any row with
//      `requested_at > now() - 24h`. If so, return 429 with the timestamp
//      so the SPA can render the next-available countdown.
//   3. Pull every dive_logs row for this user, build a CSV (one row per
//      dive, ordered oldest-first so paper-logbook order matches), email
//      it as an attachment.
//   4. INSERT a row into dive_log_export_requests for the rate limit.
//
// Body: {} (the user is identified by the Bearer token; nothing else needed).
// Returns: 200 { ok: true, dive_count, requested_at }
//          429 { error: "rate-limited", retry_after_seconds, last_requested_at }
//          204 { ok: true, dive_count: 0 } when there's nothing to export
//              (we still count this as a request to discourage hammering).

import { createClient } from "jsr:@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.14"
import { buildDiveLogCsv, DIVE_LOG_CSV_COLUMNS, type DiveLogCsvRow } from "../_shared/dive-log-csv.ts"

const COMPANY_EMAIL = "fundiverstw@gmail.com"
const COOLDOWN_HOURS = 24

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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const userId = u.user.id
  const userEmail = u.user.email
  if (!userEmail) return json({ error: "user has no email on file" }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // Rate-limit check: any request in the last COOLDOWN_HOURS hours blocks.
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString()
  const { data: recent, error: rErr } = await admin
    .from("dive_log_export_requests")
    .select("requested_at")
    .eq("user_id", userId)
    .gte("requested_at", cutoff)
    .order("requested_at", { ascending: false })
    .limit(1)
  if (rErr) return json({ error: rErr.message }, 500)
  if (recent && recent.length > 0) {
    const last = new Date(recent[0].requested_at as string)
    const nextAvailable = last.getTime() + COOLDOWN_HOURS * 3600 * 1000
    const retryAfterSeconds = Math.max(0, Math.ceil((nextAvailable - Date.now()) / 1000))
    return new Response(
      JSON.stringify({
        error: "rate-limited",
        retry_after_seconds: retryAfterSeconds,
        last_requested_at:   last.toISOString(),
      }),
      {
        status: 429,
        headers: {
          "content-type":  "application/json",
          "retry-after":   String(retryAfterSeconds),
          ...CORS_HEADERS,
        },
      },
    )
  }

  const { data: logs, error: lErr } = await admin
    .from("dive_logs")
    .select(DIVE_LOG_CSV_COLUMNS.join(","))
    .eq("user_id", userId)
    // Oldest-first matches paper-logbook chronological order.
    .order("dived_on", { ascending: true })
    .order("dive_number", { ascending: true })
  if (lErr) return json({ error: lErr.message }, 500)

  const rows = (logs ?? []) as unknown as DiveLogCsvRow[]
  const csv = buildDiveLogCsv(rows)

  if (!GMAIL_USER || !GMAIL_PASS) {
    return json({ error: "email not configured" }, 500)
  }

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    })
    const stamp = new Date().toISOString().slice(0, 10)
    const filename = `fundivers-dive-log-${stamp}.csv`
    const subject  = "FunDivers TW — your dive log export"
    const text     = rows.length === 0
      ? `Hi,\n\nYou requested a CSV export of your dive logs, but you don't have any logged dives yet. The attached file contains only the header row.\n\nLog dives any time at https://app.fundiverstw.com/records/dive-logs.\n\n— FunDivers TW`
      : `Hi,\n\nAttached is a CSV export of your ${rows.length} logged dive${rows.length === 1 ? "" : "s"} from FunDivers TW.\n\nYou can request another export 24 hours from now.\n\n— FunDivers TW`
    await transporter.sendMail({
      from: { name: "FunDivers TW", address: GMAIL_USER },
      to:      userEmail,
      bcc:     COMPANY_EMAIL,
      subject,
      text,
      attachments: [{ filename, content: csv, contentType: "text/csv; charset=utf-8" }],
    })
  } catch (e) {
    return json({ error: `email failed: ${(e as Error).message}` }, 500)
  }

  // Only record the audit row after the email succeeds — if SMTP fails
  // the user can retry without burning their daily allowance.
  const { error: insErr } = await admin
    .from("dive_log_export_requests")
    .insert({ user_id: userId })
  if (insErr) return json({ error: insErr.message }, 500)

  return json({ ok: true, dive_count: rows.length, requested_at: new Date().toISOString() })
})
