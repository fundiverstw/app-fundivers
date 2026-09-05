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

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import { shopEmail } from "../_shared/shop-contact.ts"
import { siteConfig } from "../../../fundive.config.ts"


interface DecisionBody {
  user_id:  string
  decision: "approve" | "reject"
  reason?:  string
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

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

  const newStatus = body.decision === "approve" ? "active" : "rejected"

  // Audit L1 — idempotency. A second click on Approve / Reject for a
  // target already in that state previously re-ran the update (no-op
  // by C1's column-lock trigger) and re-sent the email. Read current
  // status first; short-circuit if there's no actual transition.
  const { data: targetProfile } = await admin
    .from("profiles")
    .select("status")
    .eq("id", body.user_id)
    .maybeSingle()
  if (targetProfile?.status === newStatus) {
    return json({ ok: true, status: newStatus, email_sent: false, idempotent: true })
  }

  // Audit H6 — run the status flip through the CALLER's JWT (not
  // service-role) so the profiles audit trigger sees auth.uid() =
  // the admin's id, recognizes them via is_admin(), and writes a row
  // to admin_audit_log automatically. The admin RLS policy on
  // profiles (20260521020000_admin_profile_edit.sql) permits this
  // update; the column-lock trigger from C1 passes admin through.
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false },
  })
  const { error: updErr } = await callerClient
    .from("profiles")
    .update({ status: newStatus })
    .eq("id", body.user_id)
  if (updErr) return json({ error: safeError(updErr, "status update failed") }, 500)

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
      // Signing up needs no approval, so neither decision is ever a verdict
      // on a new application any more — both are about an account an admin put
      // on hold. The copy says so.
      const subject = body.decision === "approve"
        ? `${siteConfig.identity.shopName} — your account is active again`
        : `${siteConfig.identity.shopName} — your account has been closed`
      const text = body.decision === "approve"
        ? `Good news — your account is active again. You can log in at ${siteConfig.urls.app} and book events as usual.\n\n— ${siteConfig.identity.shopName}`
        : `Hi,\n\nYour ${siteConfig.identity.shopName} account has been closed.${
            body.reason ? `\n\nReason: ${body.reason}` : ""
          }\n\nIf you believe this is a mistake, reply to this email and we'll take another look.\n\n— ${siteConfig.identity.shopName}`
      const shopMail = await shopEmail(admin)
      await transporter.sendMail({
        from: { name: siteConfig.identity.shopName, address: GMAIL_USER },
        to:      targetEmail,
        // Copy the company on closures only — a reinstatement is routine and
        // doesn't need a business-side notification.
        ...(body.decision === "reject" && shopMail ? { bcc: shopMail } : {}),
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
