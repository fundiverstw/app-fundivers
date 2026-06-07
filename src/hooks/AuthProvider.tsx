import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { CLEAR_SUPABASE_CACHE_MSG } from '../sw-cache-policy'
import { AuthContext } from './auth-context'
import type { Profile } from '../types/database'

// Audit L12 — single source of truth for auth state. Previously every
// component that called useAuth() ran its own useState + useEffect +
// onAuthStateChange subscription. Each instance held its own copy of
// session / user / profile, with its own loading flag and its own
// async race conditions. On sign-out, one component would clear its
// profile state while another still held the previous user's profile —
// users saw their data flash back briefly before the cascade caught up.
//
// Single AuthProvider runs the subscription once at the top of the
// tree; every useAuth() reads from context. State updates flow to all
// consumers in lockstep.

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user,    setUser]    = useState<User    | null>(null)
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

  // Re-fetch the current user's profile without touching `loading` (so
  // the spinner doesn't flash). Used after server-side profile mutations
  // — e.g. re-accepting updated terms — so route guards read fresh state.
  async function refreshProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    setProfile(data)
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

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}
