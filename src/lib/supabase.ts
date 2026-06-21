import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY env vars')
}

// Snapshot the params GoTrue may leave on the URL *before* createClient's
// async detectSessionInUrl handling strips them. A recovery link that is
// expired or already consumed — commonly because an email security scanner
// pre-fetched and burned the one-time token — comes back as
// `?error=access_denied&error_code=otp_expired`; without capturing it here
// the reset page loses the signal and hangs on "Verifying…". `code` marks a
// genuine fresh recovery arrival (PKCE), letting that page tell an actual
// reset link apart from a direct visit by an already-signed-in user.
// Both PKCE (query) and the legacy implicit (hash) shapes are covered.
function readAuthCallbackParams() {
  if (typeof window === 'undefined') {
    return { code: null, error: null, errorCode: null, errorDescription: null }
  }
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const pick = (k: string) => search.get(k) ?? hash.get(k)
  return {
    code:             pick('code'),
    error:            pick('error'),
    errorCode:        pick('error_code'),
    errorDescription: pick('error_description'),
  }
}

export const authCallbackParams = readAuthCallbackParams()

// Audit M8 — PKCE flow puts the auth code in a query param + uses a
// code_verifier, so the access token never lands in the URL fragment.
// The implicit-flow default leaves access tokens in window.location.hash
// where they bleed into browser history, document.referrer, and any
// extension that observes navigation.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType:            'pkce',
    autoRefreshToken:    true,
    persistSession:      true,
    detectSessionInUrl:  true,
  },
})
