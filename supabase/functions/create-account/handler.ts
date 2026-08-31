// create-account — the whole of signing up.
//
// Why an edge function rather than a plain supabase.auth.signUp() from the SPA:
//
//   1. Captcha. A signup form open to the internet needs one, and a Turnstile
//      token is only worth anything if something verifies it server-side.
//      Supabase's own captcha setting would have worked, but it arms *every*
//      auth endpoint — sign-in and password-reset included — and putting a
//      challenge in front of sign-in is the opposite of what this redesign is
//      for.
//   2. No confirmation email. auth.admin.createUser({ email_confirm: true })
//      marks the address confirmed at creation, so the diver is signed in and
//      diving-ready on submit instead of being told to go and find an email.
//      Doing it here means it holds regardless of what the project's
//      "Confirm email" dashboard toggle happens to say.
//   3. Rate limiting. record_signup_attempt is a service-role RPC; the same
//      per-IP budget that protects the /register funnel now covers /signup.
//
// Shaped after create-registration: this file is pure logic over injected deps
// so vitest can drive it from Node, and index.ts builds the real clients.

import { corsHeaders, safeError } from "../_shared/responses.ts"
import { clientIp, sha256Hex } from "../_shared/request-identity.ts"

// Matches create-registration's budget — the two funnels mint accounts the same
// way, so they get the same allowance.
const RATE_LIMIT_PER_60S = 3
const RATE_LIMIT_PER_24H = 20

const MIN_PASSWORD_LENGTH = 8

export interface AccountBody {
  /** The diver's name as it appears on their passport / ID. Goes to
   *  profiles.name via handle_new_user, and onto boat manifests from there. */
  name?: string
  email?: string
  password?: string
  /** Present when the diver ticked the terms box. The value is not trusted —
   *  handle_new_user server-stamps now() — but its presence is the signal. */
  agreed_to_terms_at?: string
  agreed_to_terms_version?: number
  turnstile_token?: string
}

export interface TurnstileResult {
  success:     boolean
  errorCodes?: string[]
}

interface CreatedUser { id: string }

export interface Deps {
  admin: {
    auth: {
      admin: {
        createUser(opts: {
          email:          string
          password:       string
          email_confirm:  boolean
          user_metadata?: Record<string, unknown>
        }): Promise<{ data: { user: CreatedUser | null }; error: { message: string; code?: string; status?: number } | null }>
      }
    }
    // PromiseLike, not Promise: supabase-js's rpc() returns a
    // PostgrestFilterBuilder, which is a thenable with no `catch` or
    // `finally`. Typing it as a Promise compiles under vitest and then fails
    // `make check-edge` against the real client.
    rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>
  }
  anon: {
    auth: {
      signInWithPassword(opts: { email: string; password: string }): Promise<{
        data: { session: unknown | null } | null
        error: { message: string } | null
      }>
    }
  }
  verifyTurnstile: (token: string, remoteIp: string | null) => Promise<TurnstileResult>
}

// Supabase reports an address that is already taken in more than one shape
// depending on the endpoint and version — a `email_exists` code, a 422, or just
// the prose. The SPA needs to tell this one case apart from every other
// failure, because the useful answer is "sign in instead" rather than "try
// again", so we normalize it to a stable `email_exists` code in the body.
function isEmailTaken(err: { message: string; code?: string; status?: number }): boolean {
  if (err.code === "email_exists" || err.code === "user_already_exists") return true
  return /already (been )?registered|already exists/i.test(err.message)
}

export async function handleCreateAccount(req: Request, deps: Deps): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  })

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) })
  if (req.method !== "POST")    return json({ error: "method not allowed" }, 405)

  let body: AccountBody
  try { body = await req.json() as AccountBody } catch { return json({ error: "invalid json" }, 400) }

  const name     = (body.name ?? "").trim()
  const email    = (body.email ?? "").trim().toLowerCase()
  const password = body.password ?? ""

  if (!name)  return json({ error: "name required" }, 400)
  if (!email) return json({ error: "email required" }, 400)
  if (password.length < MIN_PASSWORD_LENGTH) {
    return json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400)
  }

  // Captcha and rate limit both run BEFORE createUser, so a hostile or
  // malformed request never costs a monthly active user.
  if (!body.turnstile_token) return json({ error: "captcha token required" }, 400)

  const remoteIp = clientIp(req)
  const turnstile = await deps.verifyTurnstile(body.turnstile_token, remoteIp)
  if (!turnstile.success) return json({ error: "captcha verification failed" }, 403)

  const ipHashHex = await sha256Hex(remoteIp ?? "unknown")
  const { data: counts, error: rlErr } = await deps.admin.rpc("record_signup_attempt", {
    p_ip_hash: `\\x${ipHashHex}`,
  })
  if (rlErr) return json({ error: safeError(rlErr, "rate-limit check failed") }, 500)

  const row = (Array.isArray(counts) ? counts[0] : counts) as
    { in_last_60s?: number; in_last_24h?: number } | null
  const in60s = row?.in_last_60s ?? 0
  const in24h = row?.in_last_24h ?? 0
  if (in60s > RATE_LIMIT_PER_60S || in24h > RATE_LIMIT_PER_24H) {
    return json({ error: "too many signup attempts, try again later" }, 429)
  }

  // agreed_to_terms_at is passed through as a presence signal only — the
  // trigger stamps its own now(). Omitting the key entirely when the diver
  // didn't consent is what makes the trigger leave the column null.
  const metadata: Record<string, unknown> = { name }
  if (body.agreed_to_terms_at) {
    metadata.agreed_to_terms_at      = body.agreed_to_terms_at
    metadata.agreed_to_terms_version = body.agreed_to_terms_version
  }

  const { data, error } = await deps.admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: metadata,
  })
  if (error || !data.user) {
    if (error && isEmailTaken(error)) {
      return json({ error: "email already registered", code: "email_exists" }, 409)
    }
    return json({ error: safeError(error, "could not create account") }, 400)
  }

  // Sign in on the diver's behalf so the SPA holds a session without a second
  // round-trip. A failure here is not fatal — the account exists and the
  // password is the one they just chose — so the SPA falls back to signing in
  // itself rather than showing an error over a working account.
  const { data: si } = await deps.anon.auth.signInWithPassword({ email, password })

  return json({ ok: true, user_id: data.user.id, session: si?.session ?? null })
}
