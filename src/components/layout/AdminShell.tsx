import { useEffect, useState } from 'react'
import { personName } from '../../lib/names'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { Logo } from '../Logo'
import { CalendarIcon } from '../icons/CalendarIcon'
import { ChartIcon } from '../icons/ChartIcon'
import { CrosshairIcon } from '../icons/CrosshairIcon'
import { PeopleIcon } from '../icons/PeopleIcon'
import { PlusCircleIcon } from '../icons/PlusCircleIcon'
import { LogisticsIcon } from '../icons/LogisticsIcon'
import {
  PAGE, NAV_BAR, NAV_BOTTOM,
  ON_DEEP_MUTED, ON_DEEP_SUBTLE,
} from '../../styles/tokens'

type NavItem = { to: string; label: string; icon: React.ReactNode; adminOnly?: boolean }
const adminNav: NavItem[] = [
  { to: '/admin/events',    label: 'Calendar',  icon: <CalendarIcon /> },
  { to: '/admin/logistics', label: 'Logistics', icon: <LogisticsIcon /> },
  { to: '/admin/dashboard', label: 'Dashboard', icon: <ChartIcon />,      adminOnly: true },
  { to: '/admin/users',     label: 'Divers',    icon: <PeopleIcon />,     adminOnly: true },
  { to: '/admin/duty',      label: 'Duty',      icon: <CrosshairIcon />,  adminOnly: true },
  { to: '/admin/new',       label: 'Manage',    icon: <PlusCircleIcon />, adminOnly: true },
]

export function AdminShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  // Refetch pending-applications count on every admin route change so the
  // badge reflects reality after approve/reject without needing a global
  // event bus. Only admins can read pending profiles via RLS, so we gate
  // the fetch (and the rendered badge below) on role.
  useEffect(() => {
    if (profile?.role !== 'admin') return
    let cancelled = false
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .not('application_submitted_at', 'is', null)
      .then(({ count }) => { if (!cancelled) setPendingCount(count ?? 0) })
    return () => { cancelled = true }
  }, [profile?.role, location.pathname])
  const displayPendingCount = profile?.role === 'admin' ? pendingCount : null

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className={`min-h-screen ${PAGE} flex flex-col`}>
      <header className={NAV_BAR}>
        <div className="flex-1 flex items-center justify-start gap-4" />
        <Link to="/admin" aria-label="Admin home" className="shrink-0">
          <Logo size="sm" />
        </Link>
        <div className="flex-1 flex items-center justify-end gap-3">
          {displayPendingCount != null && displayPendingCount > 0 && (
            <Link
              to="/admin/applications"
              className="text-xs font-semibold bg-accent text-white px-2 py-0.5 rounded-full hover:bg-red-400"
              aria-label={`${displayPendingCount} pending applications`}
            >
              {displayPendingCount} pending
            </Link>
          )}
          <Link to="/calendar" className="text-sm font-semibold text-amber-300 hover:text-amber-200">
            {personName(profile?.name, profile?.nickname)}
          </Link>
          <button onClick={handleSignOut} className={`text-xs ${ON_DEEP_MUTED} hover:text-white`}>
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-24">
        <Outlet />
      </main>

      <nav className={NAV_BOTTOM}>
        {adminNav.filter(i => !i.adminOnly || profile?.role === 'admin').map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
                isActive ? 'text-white font-semibold' : `${ON_DEEP_SUBTLE} hover:text-white`
              }`
            }
          >
            <span className="text-xl leading-none">{icon}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
