// admin-create-diver — admin endpoint behind AdminAddDiverModal.
//
// Flow:
//   1. Verify caller via Bearer JWT, confirm profiles.role = 'admin'.
//   2. createUser with a one-shot random password and email_confirm = true.
//      The diver never sees this password; if they later want to log in
//      they reach out and we issue temporary credentials by hand.
//   3. UPDATE the auto-created profile row (handle_new_user trigger fires
//      on the auth insert) with the admin-supplied name fields and
//      status = 'active'. The admin is vouching for the diver — we skip
//      the normal pending → review flow.
//   4. Send a courtesy "we made an account for you on your behalf" email
//      via Gmail SMTP. The diver can ignore it entirely if they don't want
//      app access. If they do, they take the account over themselves via
//      the standard password-reset flow (the throwaway password set here is
//      never shared) — the email walks them through it.
//
// Body: { email, name, nickname?, event_title? }
// Returns: { ok: true, user_id, email_sent }

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError } from "../_shared/responses.ts"

const COMPANY_EMAIL = "fundiverstw@gmail.com"

interface Body {
  email:         string
  name:     string
  nickname?: string
  event_title?:  string
}

// Throwaway password — admin never sees this. The auth.users row needs a
// password set; if the diver later wants app access they overwrite it
// themselves via the password-reset link in the courtesy email below.
function randomTempPassword(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "")
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)
  const token = auth.slice("Bearer ".length)

  let body: Body
  try { body = await req.json() as Body } catch { return json({ error: "invalid json" }, 400) }
  const email = body.email?.trim().toLowerCase()
  const fullName = body.name?.trim()
  const eventTitle = body.event_title?.trim() || null
  if (!email)    return json({ error: "email required" }, 400)
  if (!fullName) return json({ error: "name required" }, 400)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  // Admin gate.
  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: callerProfile } = await admin
    .from("profiles").select("role").eq("id", u.user.id).maybeSingle()
  if (callerProfile?.role !== "admin") return json({ error: "forbidden" }, 403)

  // Create the auth user. email_confirm=true so the diver doesn't have to
  // click a confirmation email before the recovery link works.
  const tempPassword = randomTempPassword()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password:      tempPassword,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    return json({ error: safeError(createErr, "createUser failed") }, 400)
  }
  const newUserId = created.user.id

  // handle_new_user already inserted a profile row keyed by id. Update it
  // with the admin-supplied identity fields and promote out of pending —
  // an admin manually creating the account is the verification.
  const { error: profErr } = await admin
    .from("profiles")
    .update({
      name:                fullName,
      nickname:             body.nickname?.trim() || null,
      status:                   "active",
      application_submitted_at: new Date().toISOString(),
    } as never)
    .eq("id", newUserId)
  if (profErr) {
    // Best-effort cleanup so a half-created account doesn't linger.
    await admin.auth.admin.deleteUser(newUserId).catch(() => { /* ignore */ })
    return json({ error: safeError(profErr, "profile update failed") }, 500)
  }

  // Courtesy email — points the diver at the self-service password-reset
  // flow so they can take the account over with their own password. They
  // only need to act if they want app access; otherwise their event
  // registration stands on its own.
  let emailSent = false
  if (GMAIL_USER && GMAIL_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      })
      const eventClause = eventTitle
        ? `your registration for ${eventTitle}`
        : `your event registration`
      await transporter.sendMail({
        from: { name: "FunDivers TW", address: GMAIL_USER },
        to:      email,
        bcc:     COMPANY_EMAIL,
        subject: "FunDivers TW — account created for you",
        text:
          `Hi ${fullName},\n\n` +
          `We have created a FunDivers TW app diver account on your behalf.\n\n` +
          `If you would like to access this account for all the great features on the app ` +
          `(dive logs, easy event registration, push notifications, fun games, etc.), you can ` +
          `set your own password and take it over in a minute:\n\n` +
          `  1. Go to https://app.fundiverstw.com/forgot-password\n` +
          `  2. Enter this email address: ${email}\n` +
          `  3. Open the reset link we send you and choose a password\n\n` +
          `That's it — you'll be signed in. If the link gives you any trouble, just reply to ` +
          `this email and we'll help you out.\n\n` +
          `Otherwise no further action is required for ${eventClause}.\n\n` +
          `— FunDivers TW`,
      })
      emailSent = true
    } catch (e) {
      console.error("courtesy email failed:", (e as Error).message)
    }
  }

  return json({ ok: true, user_id: newUserId, email_sent: emailSent })
})
