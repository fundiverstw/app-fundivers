import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './auth-context'

// Reads the shared auth state from AuthProvider (audit L12 — single
// source of truth so a sign-out propagates to every component in
// lockstep instead of each component running its own subscription).
// Throws if a caller renders outside the provider; that's a setup
// bug, not a runtime expectation worth silently recovering from.

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>')
  return ctx
}
