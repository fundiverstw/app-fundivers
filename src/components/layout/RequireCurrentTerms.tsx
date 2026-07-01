import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Spinner } from '../ui/Spinner'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from '../Logo'
import { CURRENT_TERMS_VERSION } from '../../lib/terms-version'

// Route guard for legal-brief item #2. If the authenticated user's
// profiles.agreed_to_terms_version is below CURRENT_TERMS_VERSION (or
// null — they never consented), every authenticated route except
// /terms itself bounces to /terms?reaccept=1. The terms page detects
// that query param and renders a re-acceptance button that calls the
// accept_current_terms RPC.
//
// Rendered inside ProtectedRoute so this only runs for signed-in
// users; loading state is handled there. If profile is still null we
// pass through — the underlying page can render its own spinner and
// the next render after profile loads will catch the mismatch.

export function RequireCurrentTerms() {
  const { profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 gap-6">
        <Logo size="xl" />
        <Spinner className="w-8 h-8 border-4 border-surface-500" />
      </div>
    )
  }

  if (!profile) return <Outlet />
  if ((profile.agreed_to_terms_version ?? 0) >= CURRENT_TERMS_VERSION) return <Outlet />
  if (location.pathname === '/terms') return <Outlet />
  return <Navigate to="/terms?reaccept=1" replace />
}
