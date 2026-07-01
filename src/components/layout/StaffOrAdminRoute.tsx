import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

// Gate for routes that staff and admin both reach (read-only event
// surfaces: calendar, event detail, gear map). Write-and-manage routes
// stay behind AdminRoute.
export function StaffOrAdminRoute() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900">
        <div className="w-8 h-8 border-4 border-surface-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  if (profile?.role !== 'admin' && profile?.role !== 'staff') {
    return <Navigate to="/calendar" replace />
  }

  return <Outlet />
}
