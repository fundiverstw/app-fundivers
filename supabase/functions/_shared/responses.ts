// Audit M4 — shared CORS + error-sanitisation helpers for every
// edge function entry point. Previously each `index.ts` shipped
// CORS `*` and echoed `err.message` verbatim (which on Postgres /
// PostgREST is the raw SQL error — constraint names, column names,
// occasionally row contents). Tightening both kills a class of
// cross-origin probing where an attacker triggers errors to map the
// schema.
//
// CORS allowlist. Origins are matched verbatim. The production origin comes
// from the shop config (siteConfig.urls.app); local dev hits the same edge
// function from the Vite dev server. Anything else gets no Access-Control-
// Allow-Origin header, which browsers translate into a CORS failure.
//
// safeError. PostgREST raises errors with a `code` (SQLSTATE) plus
// a `message` that often contains the offending column / table /
// constraint name. We map a handful of common SQLSTATEs to plain
// English, suppress the verbose `message` for all DB-shaped errors,
// and console.error the original so the dashboard log still has the
// real string for debugging. Application errors (thrown Error
// without a SQLSTATE) pass through unchanged — they're authored by
// us and don't leak schema.

import { siteConfig } from "../../../fundive.config.ts"

const ALLOWED_ORIGINS = [
  siteConfig.urls.app,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]

const CORS_BASE_HEADERS: Record<string, string> = {
  "Vary":                         "Origin",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

export function corsHeaders(req: Request): Record<string, string> {
  const headers = { ...CORS_BASE_HEADERS }
  const origin = req.headers.get("Origin") ?? ""
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin
  }
  return headers
}

export function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(req) },
  })
}

export function corsOk(req: Request): Response {
  return new Response("ok", { headers: corsHeaders(req) })
}

// The bearer token from the Authorization header, or null when the header is
// absent or not a `Bearer <token>`. Every function gates on a caller JWT, so
// this parse was copy-pasted into each entry point — centralised here.
export function bearerToken(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? ""
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null
}

// Maps a handful of common SQLSTATEs to safe public messages. Anything
// not in the table falls back to the caller-supplied `fallback`.
const SQLSTATE_SAFE_MESSAGES: Record<string, string> = {
  "23505": "Already exists.",
  "23502": "Required field missing.",
  "23503": "Referenced item not found.",
  "23514": "Validation failed.",
  "42501": "Permission denied.",
}

interface ErrorLike { message?: unknown; code?: unknown }

export function safeError(err: unknown, fallback: string): string {
  if (err == null) return fallback
  const e = err as ErrorLike
  const message = typeof e.message === "string" ? e.message : null

  // PostgREST / Postgres errors carry a code. Suppress message.
  if (typeof e.code === "string" && e.code.length > 0) {
    if (message) console.error(`safeError suppressed [${e.code}]:`, message)
    return SQLSTATE_SAFE_MESSAGES[e.code] ?? fallback
  }

  // Plain JS Error / authored throw — passes through.
  if (message) return message
  return fallback
}
