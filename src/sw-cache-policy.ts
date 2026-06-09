// Privacy gate for what the service worker is allowed to cache from
// Supabase. Pulled out of sw.ts so it can be unit-tested without the
// workbox + service-worker globals.
//
// Audit H4 — the prior policy NetworkFirst'd every *.supabase.co
// request indiscriminately. Two leaks that closed off:
//
//   1. /auth/v1/token + /auth/v1/user responses contain access_token
//      and refresh_token in the body. After sign-out, an offline
//      lookup could return the prior session's tokens to whoever
//      opens the app next on the same device.
//
//   2. Authenticated /rest/v1/* responses are RLS-scoped to the
//      caller. After a user switch, an offline read could return
//      the previous user's rows.
//
// Rule: cache only GETs, never the auth path, never anything that
// carries an Authorization header (the supabase-js client sets it
// on every authenticated call; anon-keyed reads carry only `apikey`
// and remain cacheable).

export const SUPABASE_CACHE_NAME = 'supabase-api'

export function isSupabaseCacheable(url: URL, request: Request): boolean {
  if (!url.hostname.endsWith('.supabase.co')) return false
  if (request.method !== 'GET') return false
  if (url.pathname.startsWith('/auth/v1/')) return false
  if (request.headers.has('authorization')) return false
  return true
}

// Message contract — sw.ts listens for this and clears the cache.
// useAuth.signOut posts it after a successful signOut so a future
// user on the same device doesn't see the prior user's cached rows.
export const CLEAR_SUPABASE_CACHE_MSG = { type: 'CLEAR_SUPABASE_CACHE' as const }
