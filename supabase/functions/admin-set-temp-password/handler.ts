// admin-set-temp-password — pure handler. The Deno entry (index.ts) builds
// real supabase-js clients; tests inject vi.fn() shims. Kept Deno-import-free
// so vitest can unit-test it from Node alongside the SPA suite.
//
// Capability: an admin issues a fresh, random *temporary* password for any
// diver's account and is shown the plaintext ONCE (in the JSON response) so
// they can hand it over out-of-band. This never exposes an existing password —
// those are bcrypt-hashed in auth.users and never leave the database; the
// function only OVERWRITES the password with a newly generated one.
//
// Body:    { user_id }
// Returns: { ok: true, password }  — plaintext, shown once, never persisted.

import { corsOk, jsonResponse, safeError, bearerToken } from "../_shared/responses.ts"

// Unambiguous alphabet — no 0/O/1/I/L — so a temp password read aloud, texted,
// or typed by hand can't be garbled. 32 symbols, so a byte maps to a symbol
// with no modulo bias (256 / 32 = 8). A 12-char password is ~60 bits.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateTempPassword(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const c = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length])
  // Group as XXXX-XXXX-XXXX for legibility when relayed by a human.
  return `${c.slice(0, 4).join("")}-${c.slice(4, 8).join("")}-${c.slice(8, 12).join("")}`
}

interface AuthUser { id: string; email?: string | null }

// Narrow, structurally-satisfied interfaces for the injected deps. `any` on
// the query-builder chain is deliberate — modeling PostgrestQueryBuilder's
// generics buys nothing here (matches create-registration/handler.ts).
export interface SupabaseAdminClient {
  auth: {
    admin: {
      updateUserById(
        id: string,
        attrs: { password?: string },
      ): Promise<{ data: { user: AuthUser | null }; error: { message: string } | null }>
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

export interface SupabaseAnonClient {
  auth: {
    getUser(token: string): Promise<{ data: { user: AuthUser | null }; error: { message: string } | null }>
  }
}

export interface Deps {
  admin: SupabaseAdminClient
  anon: SupabaseAnonClient
  // Injectable so tests get a deterministic value; production omits it.
  generatePassword?: () => string
}

interface Body { user_id?: string }

export async function handleSetTempPassword(req: Request, deps: Deps): Promise<Response> {
  const json = (body: unknown, status = 200) => jsonResponse(req, body, status)
  if (req.method === "OPTIONS") return corsOk(req)
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  const token = bearerToken(req)
  if (!token) return json({ error: "unauthorized" }, 401)

  let body: Body
  try { body = await req.json() as Body } catch { return json({ error: "invalid json" }, 400) }
  const targetId = body.user_id?.trim()
  if (!targetId) return json({ error: "user_id required" }, 400)

  // Admin gate — resolve the caller from their JWT, then confirm role=admin
  // with the service-role client (same shape as admin-create-diver).
  const { data: u, error: uErr } = await deps.anon.auth.getUser(token)
  if (uErr || !u.user) return json({ error: "invalid bearer" }, 401)

  const { data: callerProfile } = await deps.admin
    .from("profiles").select("role").eq("id", u.user.id).maybeSingle()
  if (callerProfile?.role !== "admin") return json({ error: "forbidden" }, 403)

  // The target must be a real profile before we touch auth.
  const { data: target, error: targetErr } = await deps.admin
    .from("profiles").select("id").eq("id", targetId).maybeSingle()
  if (targetErr) return json({ error: safeError(targetErr, "lookup failed") }, 500)
  if (!target)   return json({ error: "user not found" }, 404)

  const password = (deps.generatePassword ?? generateTempPassword)()
  const { error: updErr } = await deps.admin.auth.admin.updateUserById(targetId, { password })
  if (updErr) return json({ error: safeError(updErr, "could not set password") }, 400)

  // Audit trail — WITHOUT the plaintext. Enough to answer "who reset whose
  // password, and when"; the secret itself is never persisted anywhere. A
  // failed audit insert must not fail the reset (the password is already set),
  // so it's logged and swallowed.
  const { error: auditErr } = await deps.admin.from("admin_audit_log").insert({
    actor_id:     u.user.id,
    action:       "update",
    target_table: "auth.users",
    target_id:    targetId,
    before:       null,
    after:        { event: "temp_password_issued" },
  })
  if (auditErr) console.error("temp-password audit insert failed:", safeError(auditErr, "audit failed"))

  return json({ ok: true, password })
}
