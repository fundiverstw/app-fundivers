import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '../types/database'

// Split from AuthProvider.tsx so react-refresh works cleanly — its
// "only export components" rule trips when a context is exported
// alongside a component from the same module. AuthProvider is in its
// sibling file; both consume this context type.

export interface AuthContextValue {
  session: Session | null
  user:    User    | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  // Re-fetch the signed-in user's profile into context. Callers that
  // mutate the profile server-side (e.g. accepting updated terms via the
  // accept_current_terms RPC) must call this before relying on the new
  // value, otherwise route guards keep reading the stale cached profile.
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
