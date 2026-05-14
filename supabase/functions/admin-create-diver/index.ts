// admin-create-diver — admin endpoint behind AdminAddDiverModal.
//
// Flow:
//   1. Verify caller via Bearer JWT, confirm profiles.role = 'admin'.
//   2. createUser with a one-shot random password and email_confirm = true,
//      so the new diver does not need to click a confirmation link before
//      they can log in.
//   3. UPDATE the auto-created profile row (handle_new_user trigger fires
//      on the auth insert) with the admin-supplied name fields and
//      status = 'active'. The admin is vouching for the diver — we skip
//      the normal pending → review flow.
//   4. generateLink(type='recovery') against the new email to mint a
//      one-time link that lands the diver on /reset-password with a
//      recovery-scoped session. We send the link via Gmail SMTP so we
//      bypass Supabase's built-in email rate limits and stay consistent
//      with notify-application-decision.
//
// Body: { email, full_name, display_name?, name_alt?, redirect_to }
// Returns: { ok: true, user_id, email_sent }

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

interface Body {
  email:         string
  full_name:     string
  display_name?: string
  name_alt?:     string
  redirect_to:   string
}

// 32 chars of crypto-random base64 — admin never sees this. The diver gets
// in via the recovery link, sets their own password, and this throwaway
// password is overwritten.
function randomTempPassword(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS })
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const auth = req.headers.get("Authorization") ?? ""
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401)
  const token = auth.slice("Bearer ".length)

  let body: Body
  try { body = await req.json() as Body } catch { return json({ error: "invalid json" }, 400) }
  const email = body.email?.trim().toLowerCase()
  const fullName = body.full_name?.trim()
  const redirectTo = body.redirect_to?.trim()
  if (!email)       return json({ error: "email required" }, 400)
  if (!fullName)    return json({ error: "full_name required" }, 400)
  if (!redirectTo)  return json({ error: "redirect_to required" }, 400)

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
    return json({ error: createErr?.message ?? "createUser failed" }, 400)
  }
  const newUserId = created.user.id

  // handle_new_user already inserted a profile row keyed by id. Update it
  // with the admin-supplied identity fields and promote out of pending —
  // an admin manually creating the account is the verification.
  const { error: profErr } = await admin
    .from("profiles")
    .update({
      full_name:                fullName,
      display_name:             body.display_name?.trim() || null,
      name_alt:                 body.name_alt?.trim() || null,
      status:                   "active",
      application_submitted_at: new Date().toISOString(),
    } as never)
    .eq("id", newUserId)
  if (profErr) {
    // Best-effort cleanup so a half-created account doesn't linger.
    await admin.auth.admin.deleteUser(newUserId).catch(() => { /* ignore */ })
    return json({ error: profErr.message }, 500)
  }

  // Mint the password-set link. type='recovery' against the just-created
  // user gives them a one-time link that the existing /reset-password page
  // already handles (PASSWORD_RECOVERY auth event → updateUser({password})).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type:    "recovery",
    email,
    options: { redirectTo },
  })
  const actionLink = link?.properties?.action_link ?? null
  if (linkErr || !actionLink) {
    return json({
      ok:        true,
      user_id:   newUserId,
      email_sent: false,
      warning:   "Account created but recovery link could not be generated. Diver can use 'Forgot password' on the login page.",
    })
  }

  // Email the link via Gmail SMTP. Best-effort: the account exists already,
  // so admin can re-trigger via Forgot Password if SMTP is misconfigured.
  let emailSent = false
  if (GMAIL_USER && GMAIL_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      })
      await transporter.sendMail({
        from: { name: "FunDivers TW", address: GMAIL_USER },
        to:      email,
        bcc:     COMPANY_EMAIL,
        subject: "FunDivers TW — set your password",
        text:
          `Hi ${fullName},\n\n` +
          `An account has been created for you at FunDivers TW. To finish setting up, click the link below to choose your password:\n\n` +
          `${actionLink}\n\n` +
          `Once you've set a password you can sign in at https://app.fundiverstw.com any time.\n\n` +
          `— FunDivers TW`,
      })
      emailSent = true
    } catch (e) {
      console.error("invite email failed:", (e as Error).message)
    }
  }

  return json({ ok: true, user_id: newUserId, email_sent: emailSent })
})
