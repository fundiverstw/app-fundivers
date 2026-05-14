// create-child-account — parent-initiated child diver creation.
//
// Mirrors admin-create-diver but the caller doesn't need to be admin: any
// active diver can call this to add a child account managed by them. The
// new child gets parent_account = caller_id, status = 'active' (no manual
// review — the parent is vouching), and a random throwaway password the
// child never sees.
//
// One-level family trees are enforced server-side here AND by the
// trg_profiles_one_level_family trigger in 20260514030000. Belt + braces:
// the trigger is the source of truth; the function pre-check gives a
// nicer error message before we burn a createUser call.
//
// Body: { email, full_name, display_name?, name_alt? }
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
}

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
  if (!email)    return json({ error: "email required" }, 400)
  if (!fullName) return json({ error: "full_name required" }, 400)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!
  const GMAIL_USER   = Deno.env.get("GMAIL_USER")
  const GMAIL_PASS   = Deno.env.get("GMAIL_APP_PASSWORD")

  // Verify the caller.
  const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await caller.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)
  const parentId = u.user.id

  // Caller must be an active, top-level diver. We pre-check both rules
  // the trigger would catch so the error message is friendly.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: parentProfile, error: pErr } = await admin
    .from("profiles")
    .select("id, status, parent_account")
    .eq("id", parentId)
    .maybeSingle()
  if (pErr || !parentProfile) return json({ error: "profile not found" }, 403)
  if (parentProfile.status !== "active") {
    return json({ error: "your account must be approved before you can add child accounts" }, 403)
  }
  if (parentProfile.parent_account) {
    return json({ error: "child accounts cannot themselves create children (one-level family trees only)" }, 403)
  }

  // Create the auth user. email_confirm = true so the child can log in
  // directly if they ever want to (parent provides credentials manually).
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

  // handle_new_user already inserted the row keyed by id. Patch in the
  // admin-supplied fields, mark active, and wire the parent FK.
  const { error: profErr } = await admin
    .from("profiles")
    .update({
      full_name:                fullName,
      display_name:             body.display_name?.trim() || null,
      name_alt:                 body.name_alt?.trim() || null,
      status:                   "active",
      parent_account:           parentId,
      application_submitted_at: new Date().toISOString(),
    } as never)
    .eq("id", newUserId)
  if (profErr) {
    // Best-effort cleanup so a half-created account doesn't linger.
    await admin.auth.admin.deleteUser(newUserId).catch(() => { /* ignore */ })
    return json({ error: profErr.message }, 500)
  }

  // Courtesy email to the child. Mirrors the admin-create-diver wording —
  // we don't expose credentials. If the child wants direct app access they
  // reach out to the shop.
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
        subject: "FunDivers TW — account created for you",
        text:
          `Hi ${fullName},\n\n` +
          `${parentProfile ? '' : ''}` +
          `A FunDivers TW app diver account has been created on your behalf so we can register you for events.\n\n` +
          `If you would like to access this account for all the great features on the app ` +
          `(dive logs, easy event registration, push notifications, etc.) please reply to this email ` +
          `or message us, and we'll issue you a temporary username and password to log in with.\n\n` +
          `Otherwise no further action is required.\n\n` +
          `— FunDivers TW`,
      })
      emailSent = true
    } catch (e) {
      console.error("create-child-account email failed:", (e as Error).message)
    }
  }

  return json({ ok: true, user_id: newUserId, email_sent: emailSent })
})
