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
// Body: { email, name, nickname? }
// Returns: { ok: true, user_id, email_sent }

import { createClient } from "jsr:@supabase/supabase-js@2.103.2"
import nodemailer from "npm:nodemailer@6.9.14"
import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"
import { takeActionSlot, rateLimitedBody } from "../_shared/rate-limit.ts"
import { shopEmail } from "../_shared/shop-contact.ts"
import { siteConfig } from "../../../fundive.config.ts"


// Keep in step with trg_profiles_child_account_cap, which is the authority.
const MAX_CHILD_ACCOUNTS = 10

interface Body {
  email:         string
  name:     string
  nickname?: string
}

function randomTempPassword(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "")
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

  let body: Body
  try { body = await req.json() as Body } catch { return json({ error: "invalid json" }, 400) }
  const email = body.email?.trim().toLowerCase()
  const fullName = body.name?.trim()
  if (!email)    return json({ error: "email required" }, 400)
  if (!fullName) return json({ error: "name required" }, 400)

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
    .select("id, status, parent_account, name, nickname")
    .eq("id", parentId)
    .maybeSingle()
  if (pErr || !parentProfile) return json({ error: "profile not found" }, 403)
  if (parentProfile.status !== "active") {
    return json({ error: "your account must be approved before you can add child accounts" }, 403)
  }
  if (parentProfile.parent_account) {
    return json({ error: "child accounts cannot themselves create children (one-level family trees only)" }, 403)
  }

  // Ceiling on how many accounts one diver may mint. The authority is
  // trg_profiles_child_account_cap; this pre-check exists so the diver reads a
  // sentence rather than a constraint violation, and so we don't burn a
  // createUser call we're about to roll back.
  const { count: childCount, error: cErr } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("parent_account", parentId)
  if (cErr) return json({ error: safeError(cErr, "could not count child accounts") }, 500)
  if ((childCount ?? 0) >= MAX_CHILD_ACCOUNTS) {
    return json({
      error: `you already manage ${MAX_CHILD_ACCOUNTS} child accounts, which is the maximum — contact us if you need more`,
    }, 403)
  }

  // Separate from the cap: the cap bounds how many accounts may EXIST, this
  // bounds how fast they may be attempted. Deleting a child to free a slot must
  // not hand back an unlimited mail sender.
  const slot = await takeActionSlot(admin, parentId, "create_child_account")
  if (!slot.allowed) {
    return json(rateLimitedBody("create_child_account", slot.retryAfterSeconds), 429)
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
    return json({ error: safeError(createErr, "createUser failed") }, 400)
  }
  const newUserId = created.user.id

  // handle_new_user already inserted the row keyed by id. Patch in the
  // admin-supplied fields, mark active, and wire the parent FK.
  const { error: profErr } = await admin
    .from("profiles")
    .update({
      name:                fullName,
      nickname:             body.nickname?.trim() || null,
      status:                   "active",
      parent_account:           parentId,
      application_submitted_at: new Date().toISOString(),
    } as never)
    .eq("id", newUserId)
  if (profErr) {
    // Best-effort cleanup so a half-created account doesn't linger.
    await admin.auth.admin.deleteUser(newUserId).catch(() => { /* ignore */ })
    return json({ error: safeError(profErr, "profile update failed") }, 500)
  }

  // Who did this, recorded where the shop can see it. Creating an account for
  // an address you don't own is the abuse this endpoint enables; the cap bounds
  // it, and this row is what makes a pattern of it visible after the fact. A
  // failed audit insert must not fail the creation, which already succeeded.
  const { error: auditErr } = await admin.from("admin_audit_log").insert({
    actor_id:     parentId,
    action:       "insert",
    target_table: "profiles",
    target_id:    newUserId,
    before:       null,
    after:        { event: "child_account_created", email },
  })
  if (auditErr) console.error("child-account audit insert failed:", safeError(auditErr, "audit failed"))

  // Courtesy email to the child. Mirrors the admin-create-diver wording —
  // we don't expose credentials. If the child wants direct app access they
  // reach out to the shop. It names the parent so a recipient who doesn't
  // recognize them has something to push back on.
  const parentLabel = [parentProfile.name, parentProfile.nickname ? `(${parentProfile.nickname})` : null]
    .filter(Boolean).join(" ") || "Another diver"
  let emailSent = false
  if (GMAIL_USER && GMAIL_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      })
      const shopMail = await shopEmail(admin)
      await transporter.sendMail({
        from: { name: siteConfig.identity.shopName, address: GMAIL_USER },
        to:      email,
        ...(shopMail ? { bcc: shopMail } : {}),
        subject: `${siteConfig.identity.shopName} — account created for you`,
        text:
          `Hi ${fullName},\n\n` +
          `${parentLabel} has created a ${siteConfig.identity.shopName} app diver account for you, ` +
          `so they can register you for events. They manage the account on your behalf.\n\n` +
          `If you would like to access this account for all the great features on the app ` +
          `(dive logs, easy event registration, push notifications, etc.) please reply to this email ` +
          `or message us, and we'll issue you a temporary username and password to log in with.\n\n` +
          `If you don't know ${parentLabel}, or you didn't expect this, please reply to this email ` +
          `and we'll remove the account.\n\n` +
          `Otherwise no further action is required.\n\n` +
          `— ${siteConfig.identity.shopName}`,
      })
      emailSent = true
    } catch (e) {
      console.error("create-child-account email failed:", (e as Error).message)
    }
  }

  return json({ ok: true, user_id: newUserId, email_sent: emailSent })
})
