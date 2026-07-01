import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

// Manual-verification gate. Pending / rejected divers are bounced to
// /pending — they can't see the calendar or anything that would hint at
// the rest of the app until an admin approves. Staff and admin bypass
// this gate so a user whose profile is somehow in a non-active state
// can still operate (think: data fix gone wrong, or a freshly-promoted
// admin whose profile predates the column).
//
// Mount nested inside ProtectedRoute — by the time we render here, the
// session check has already passed.
export function RequireActive() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="w-8 h-8 border-4 border-surface-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  if (profile?.role === 'admin' || profile?.role === 'staff') return <Outlet />

  if (profile?.status !== 'active') return <Navigate to="/pending" replace />

  return <Outlet />
}
