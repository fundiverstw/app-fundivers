import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'

// Wire-level fetch helpers. Deliberately do NOT use supabase-js for the
// probe itself — supabase-js abstracts headers, query operators, JSON
// shape, and retries. Probes need to send the exact bytes an attacker
// would, so we build requests by hand. supabase-js is used only for
// setup convenience (create users, sign in, fetch tokens) — never to
// execute the attack itself.

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`security probe: ${name} env var missing — is the local stack up?`)
  return v
}

export const API_URL          = () => env('API_URL').replace(/\/$/, '')
export const ANON_KEY         = () => env('ANON_KEY')
export const SERVICE_ROLE_KEY = () => env('SERVICE_ROLE_KEY')

export const restUrl = (path: string) => `${API_URL()}/rest/v1${path}`
export const authUrl = (path: string) => `${API_URL()}/auth/v1${path}`
// Edge-function probes require `supabase functions serve` running
// locally — the edge runtime container is not part of the default
// `make start` set. Probes that hit fnUrl() should await
// `requireEdgeRuntime()` first so they fail loud with a clear
// remediation message when the runtime is down, instead of timing out
// or returning a confusing 503.
export const fnUrl   = (name: string) => `${API_URL()}/functions/v1/${name}`

let edgeRuntimeReady: boolean | null = null
export async function requireEdgeRuntime(): Promise<void> {
  if (edgeRuntimeReady === true) return
  if (edgeRuntimeReady === false) throw new Error(EDGE_RUNTIME_DOWN_MSG)
  try {
    const r = await fetch(`${API_URL()}/functions/v1/`, { method: 'OPTIONS' })
    edgeRuntimeReady = r.status !== 503
  } catch {
    edgeRuntimeReady = false
  }
  if (!edgeRuntimeReady) throw new Error(EDGE_RUNTIME_DOWN_MSG)
}
const EDGE_RUNTIME_DOWN_MSG =
  'edge runtime not reachable at /functions/v1 — start it with `supabase functions serve` before running edge-function probes'

export interface ProbeResponse {
  status: number
  ok: boolean
  headers: Headers
  text: string
  json: () => unknown   // parsed lazily; throws if the body isn't valid JSON
}

async function readResponse(r: Response): Promise<ProbeResponse> {
  const text = await r.text()
  let parsed: unknown = undefined
  let parseErr: unknown = undefined
  return {
    status: r.status,
    ok: r.ok,
    headers: r.headers,
    text,
    json: () => {
      if (parsed !== undefined) return parsed
      if (parseErr !== undefined) throw parseErr
      try { parsed = JSON.parse(text); return parsed } catch (e) { parseErr = e; throw e }
    },
  }
}

interface RawOpts {
  method?: string
  headers?: Record<string, string>
  body?: string | object
}

/**
 * Send a raw HTTP request and return a structured response.
 *
 * Headers are merged on top of the default `{ apikey: ANON_KEY }` so a
 * probe that doesn't set one is still authenticated as anon (matching
 * what an attacker hitting the public PostgREST URL would see). Pass
 * `apikey: ''` explicitly to test the "no apikey at all" case.
 */
export async function rawFetch(url: string, opts: RawOpts = {}): Promise<ProbeResponse> {
  const headers: Record<string, string> = { apikey: ANON_KEY(), ...opts.headers }
  if (headers.apikey === '') delete headers.apikey
  let body: BodyInit | undefined
  if (opts.body !== undefined) {
    if (typeof opts.body === 'string') {
      body = opts.body
    } else {
      body = JSON.stringify(opts.body)
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
    }
  }
  const r = await fetch(url, { method: opts.method ?? 'GET', headers, body })
  return readResponse(r)
}

/**
 * Sign in via the live /auth/v1/token endpoint and return the JWT. We
 * could grab this from supabase-js, but going through the raw endpoint
 * makes the test self-contained — if /auth/v1 changes shape the probe
 * suite notices, not just the integration suite.
 */
export async function getAccessToken(email: string, password: string): Promise<string> {
  const r = await rawFetch(`${authUrl('/token')}?grant_type=password`, {
    method: 'POST',
    body: { email, password },
  })
  if (!r.ok) throw new Error(`probe sign-in failed (${r.status}): ${r.text}`)
  const body = r.json() as { access_token?: string }
  if (!body.access_token) throw new Error(`probe sign-in returned no access_token: ${r.text}`)
  return body.access_token
}

export function bearerHeaders(token: string): Record<string, string> {
  return { apikey: ANON_KEY(), Authorization: `Bearer ${token}` }
}

export function serviceHeaders(): Record<string, string> {
  return { apikey: SERVICE_ROLE_KEY(), Authorization: `Bearer ${SERVICE_ROLE_KEY()}` }
}

/**
 * Convenience: sign in a known throwaway user (from helpers.ts) and
 * return a function that builds Bearer headers for that user. Saves
 * the per-test `Authorization` plumbing.
 */
export async function loginAs(email: string, password: string): Promise<{
  token: string
  headers: () => Record<string, string>
}> {
  const token = await getAccessToken(email, password)
  return { token, headers: () => bearerHeaders(token) }
}

// supabase-js admin client for setup only — never used for the attack
// itself. Re-exported so probe files don't have to redefine it.
export function adminClient() {
  return createClient<Database>(API_URL(), SERVICE_ROLE_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
