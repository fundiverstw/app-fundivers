import { supabase } from './supabase'

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
