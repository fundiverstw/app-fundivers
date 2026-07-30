import { supabase } from './supabase'
import { edgeErrorMessage } from './edge-invoke'

// The shop's Terms of Use live in the DB (migration 20260711100000), not in
// code: the shop authors them in admin -> Manage. `version` gates re-acceptance
// and is bumped only when an admin marks an edit as a material change.
//
// The row is fetched once per session and memoised: RequireCurrentTerms consults
// the version on every protected navigation, and that must not be a round-trip
// each time. `invalidateTerms()` drops the cache after an admin saves.

export interface Terms {
  title: string
  body: string
  version: number
  /** ISO timestamp of the last admin save. */
  updatedAt: string
}

let cache: Promise<Terms | null> | null = null

export function fetchTerms(): Promise<Terms | null> {
  if (!cache) {
    cache = (async () => {
      const { data, error } = await supabase.from('terms').select('title, body, version, updated_at').single()
      if (error || !data) {
        // A read failure must not lock every diver out of the app: callers treat
        // null as "unknown" and let them through rather than bouncing. Drop the
        // cache so the next caller retries.
        cache = null
        return null
      }
      const { updated_at, ...rest } = data
      return { ...rest, updatedAt: updated_at }
    })()
  }
  return cache
}

export function invalidateTerms(): void {
  cache = null
}

/**
 * Record consent. Takes no version: the server reads `terms.version` itself, so
 * a modified client cannot accept a version it was never shown. Returns the
 * version actually recorded.
 */
export async function acceptCurrentTerms(): Promise<number> {
  const { data, error } = await supabase.rpc('accept_current_terms')
  if (error) throw error
  return data as number
}

// ── Consent without a session ────────────────────────────────────────────────
// A diver whose account the shop minted for them has no password and no reason
// to get one, so the in-app gate above never reaches them. They consent instead
// by opening a one-time link from their email; these two wrap the anon-callable
// RPCs behind it. Neither needs a session, and neither returns anything about
// the diver — the token is the only thing identifying them.

export type TermsTokenState = 'valid' | 'used' | 'expired' | 'unknown'

export async function termsTokenState(token: string): Promise<TermsTokenState> {
  const { data, error } = await supabase.rpc('terms_consent_token_state', { p_token: token })
  // A failed read must not read as a valid link: the diver would tap Accept and
  // get a raw error instead of "ask us for a fresh link".
  if (error) throw error
  return data as TermsTokenState
}

/** Records consent and burns the token. Returns the version recorded. */
export async function acceptTermsWithToken(token: string): Promise<number> {
  const { data, error } = await supabase.rpc('accept_terms_with_token', { p_token: token })
  if (error) throw error
  return data as number
}

/** The status of a consent link, WITHOUT the token itself. */
export interface TermsConsentToken {
  created_at: string
  expires_at: string
  used_at: string | null
}

/**
 * Admin-only (RLS): when the most recent consent link was minted and whether it
 * has been used, for the "link sent / accepted" line on the user card.
 *
 * The `token` column is deliberately NOT selected. It is a bearer credential
 * that redeems consent, and the card only needs dates — shipping it into an
 * admin's browser would invite a "copy link" button that lets the shop accept
 * the terms on the diver's behalf, which is the one thing this design refuses.
 */
export async function fetchLatestTermsToken(userId: string): Promise<TermsConsentToken | null> {
  const { data, error } = await supabase
    .from('terms_consent_tokens')
    .select('created_at, expires_at, used_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ?? null
}

/** Admin-only: mint a fresh link and email it to the diver. */
export async function sendTermsRequest(userId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('send-terms-request', {
    body: { user_id: userId },
  })
  if (error) throw new Error(await edgeErrorMessage(error))
}
