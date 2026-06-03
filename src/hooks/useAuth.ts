import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { CLEAR_SUPABASE_CACHE_MSG } from '../sw-cache-policy'
import type { Profile } from '../types/database'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(data)
    setLoading(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signOut() {
    // scope:'local' invalidates only the current device's session.
    // The default ('global') revokes the user's refresh tokens
    // server-side, which kicks them off every other device they're
    // logged in on too — not what users expect when they sign out
    // of one browser. Sessions are per-environment.
    await supabase.auth.signOut({ scope: 'local' })
    // Audit H4 — nuke the supabase-api SW cache so a future user on
    // this device can't be served the prior user's RLS-scoped reads.
    // Best-effort: if the SW controller isn't ready (private mode,
    // first load) the cache wasn't populated under that user anyway.
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage(CLEAR_SUPABASE_CACHE_MSG)
    }
  }

  return { session, user, profile, loading, signOut }
}
