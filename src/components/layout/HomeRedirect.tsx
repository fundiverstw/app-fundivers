import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from '../Logo'

// Default landing route after sign-in (and the catch-all for unknown
// URLs). Admins go straight to their own calendar — they spend their
// time on the admin shell, not the diver one — and everyone else lands
// on the diver calendar. Unauthenticated visitors fall through to
// /calendar, which ProtectedRoute then bounces to /login.
export function HomeRedirect() {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 gap-6">
        <Logo size="xl" />
        <div className="w-8 h-8 border-4 border-surface-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (profile?.role === 'admin') return <Navigate to="/admin/events" replace />
  return <Navigate to="/calendar" replace />
}
