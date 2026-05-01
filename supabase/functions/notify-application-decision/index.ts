// notify-application-decision — admin endpoint behind /admin/applications.
//
// Flow:
//   1. Verify caller via Bearer JWT, confirm profiles.role = 'admin'.
//   2. UPDATE profiles SET status = decision (active|rejected) for the
//      target user.
//   3. Email the diver via Gmail SMTP. Failure here is logged but not
//      fatal — the status flip is the source of truth.
//
// Body: { user_id: string, decision: 'approve' | 'reject', reason?: string }
// Returns: { ok: true }
//
// We intentionally don't expose this as a direct profiles UPDATE from the
// SPA: the admin RLS already permits it, but funnelling it through one
// endpoint lets us run the email send in the same request and gives one
// place to add audit-log writes / rate limits later.

import { createClient } from "jsr:@supabase/supabase-js@2"
import nodemailer from "npm:nodemailer@6.9.14"

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

interface DecisionBody {
  user_id:  string
  decision: "approve" | "reject"
  reason?:  string
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)
  const token = auth.slice("Bearer ".length)

  let body: DecisionBody
  try { body = await req.json() as DecisionBody } catch { return json({ error: "invalid json" }, 400) }
  if (!body.user_id) return json({ error: "user_id required" }, 400)
  if (body.decision !== "approve" && body.decision !== "reject") {
    return json({ error: "decision must be 'approve' or 'reject'" }, 400)
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  // Admin gate: pass token explicitly (getUser() with no arg returns null
  // in worker contexts that don't persist a session).
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
  })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })
  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", u.user.id)
    .maybeSingle()
  if (callerProfile?.role !== "admin") return json({ error: "forbidden" }, 403)

  // Update target.
  const newStatus = body.decision === "approve" ? "active" : "rejected"
  const { error: updErr } = await admin
    .from("profiles")
    .update({ status: newStatus })
    .eq("id", body.user_id)
  if (updErr) return json({ error: updErr.message }, 500)

  // Look up the target's email for the notification.
  const { data: target } = await admin.auth.admin.getUserById(body.user_id)
  const targetEmail = target?.user?.email ?? null

  // Best-effort email. Skipped silently if Gmail creds aren't set or the
  // target somehow has no email — the status flip is the source of truth.
  let emailSent = false
  if (targetEmail && GMAIL_USER && GMAIL_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      })
      const subject = body.decision === "approve"
        ? "FunDivers TW — your account is approved"
        : "FunDivers TW — application not approved"
      const text = body.decision === "approve"
        ? `Welcome aboard! Your account has been approved. You can now log in at https://app.fundiverstw.com and book events.\n\n— FunDivers TW`
        : `Hi,\n\nYour FunDivers TW application was reviewed and not approved at this time.${
            body.reason ? `\n\nReason: ${body.reason}` : ""
          }\n\nIf you believe this is a mistake, reply to this email and we'll take another look.\n\n— FunDivers TW`
      await transporter.sendMail({
        from: { name: "FunDivers TW", address: GMAIL_USER },
        to:      targetEmail,
        bcc:     COMPANY_EMAIL,
        subject,
        text,
      })
      emailSent = true
    } catch (e) {
      console.error("decision email failed:", (e as Error).message)
    }
  }

  return json({ ok: true, status: newStatus, email_sent: emailSent })
})
