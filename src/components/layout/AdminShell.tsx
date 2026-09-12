import { useEffect, useState } from 'react'
import { personName } from '../../lib/names'
import { NavLink, Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import {
  countOnHoldAccounts, countOpenRefundRequests, countOpenDiscountRequests,
} from '../../lib/admin-pending'
import { Logo } from '../Logo'
import { CalendarIcon } from '../icons/CalendarIcon'
import { CrosshairIcon } from '../icons/CrosshairIcon'
import { PeopleIcon } from '../icons/PeopleIcon'
import { PlusCircleIcon } from '../icons/PlusCircleIcon'
import { ChartIcon } from '../icons/ChartIcon'
import { LogisticsIcon } from '../icons/LogisticsIcon'
import { t } from '../../i18n'
import {
  PAGE, NAV_BAR, NAV_BOTTOM,
  ON_DEEP_MUTED, ON_DEEP_SUBTLE,
} from '../../styles/tokens'

type NavItem = {
  to: string
  label: string
  icon: React.ReactNode
  adminOnly?: boolean
  /** Shown only to staff. Admins reach the same page from the Manage hub —
   *  a staff nav is two items long and has room, an admin's is already five. */
  staffOnly?: boolean
}
const adminNav: NavItem[] = [
  { to: '/admin/events',     label: t.nav.calendar,  icon: <CalendarIcon /> },
  { to: '/admin/logistics',  label: t.nav.logistics, icon: <LogisticsIcon /> },
  { to: '/admin/accounting', label: t.nav.revenue,   icon: <ChartIcon />,      staffOnly: true },
  { to: '/admin/users',      label: t.nav.divers,    icon: <PeopleIcon />,     adminOnly: true },
  { to: '/admin/duty',       label: t.nav.duty,      icon: <CrosshairIcon />,  adminOnly: true },
  { to: '/admin/new',        label: t.nav.manage,    icon: <PlusCircleIcon />, adminOnly: true },
]

export function AdminShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [pendingCount, setPendingCount] = useState<number | null>(null)
  const [refundCount, setRefundCount] = useState<number | null>(null)
  const [discountCount, setDiscountCount] = useState<number | null>(null)

  // Refetch on every admin route change so the badges reflect reality after an
  // approve/reject without a global event bus. Only admins can read these rows
  // via RLS, so we gate the fetch (and the rendered badges below) on role.
  //
  // The counts themselves live in src/lib/admin-pending.ts, because the Manage
  // hub puts a chip on the same three pages. Two copies of "what counts as
  // waiting" drift, and the first thing to go wrong is a badge that disagrees
  // with the queue it links to.
  useEffect(() => {
    if (profile?.role !== 'admin') return
    let cancelled = false
    countOnHoldAccounts()
      .then(n => { if (!cancelled) setPendingCount(n) })
      .catch(() => {})
    countOpenRefundRequests()
      .then(n => { if (!cancelled) setRefundCount(n) })
      .catch(() => {})
    countOpenDiscountRequests()
      .then(n => { if (!cancelled) setDiscountCount(n) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [profile?.role, location.pathname])
  const displayPendingCount = profile?.role === 'admin' ? pendingCount : null
  const displayRefundCount = profile?.role === 'admin' ? refundCount : null
  const displayDiscountCount = profile?.role === 'admin' ? discountCount : null

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className={`min-h-screen ${PAGE} flex flex-col`}>
      <header className={NAV_BAR}>
        <div className="flex-1 flex items-center justify-start gap-4">
          {displayRefundCount != null && displayRefundCount > 0 && (
            <Link
              to="/admin/refunds"
              className="text-xs font-semibold bg-accent text-white px-2 py-0.5 rounded-full hover:bg-red-400"
              aria-label={t.shell.pendingRefundsAria(displayRefundCount)}
            >
              {t.shell.pendingRefunds(displayRefundCount)}
            </Link>
          )}
          {displayDiscountCount != null && displayDiscountCount > 0 && (
            <Link
              to="/admin/discounts"
              className="text-xs font-semibold bg-accent text-white px-2 py-0.5 rounded-full hover:bg-red-400"
              aria-label={t.shell.pendingDiscountsAria(displayDiscountCount)}
            >
              {t.shell.pendingDiscounts(displayDiscountCount)}
            </Link>
          )}
        </div>
        <Link to="/admin/home" aria-label={t.shell.adminHome} className="shrink-0">
          <Logo size="sm" />
        </Link>
        <div className="flex-1 flex items-center justify-end gap-3">
          {displayPendingCount != null && displayPendingCount > 0 && (
            <Link
              to="/admin/applications"
              className="text-xs font-semibold bg-accent text-white px-2 py-0.5 rounded-full hover:bg-red-400"
              aria-label={t.shell.pendingApplications(displayPendingCount)}
            >
              {t.shell.pending(displayPendingCount)}
            </Link>
          )}
          <Link to="/calendar" className="text-sm font-semibold text-amber-300 hover:text-amber-200">
            {personName(profile?.name, profile?.nickname)}
          </Link>
          <button onClick={handleSignOut} className={`text-xs ${ON_DEEP_MUTED} hover:text-white`}>
            {t.common.signOut}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-24">
        <Outlet />
      </main>

      <nav className={NAV_BOTTOM}>
        {adminNav
          .filter(i => (!i.adminOnly || profile?.role === 'admin') && (!i.staffOnly || profile?.role !== 'admin'))
          .map(({ to, label, icon }) => (
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
