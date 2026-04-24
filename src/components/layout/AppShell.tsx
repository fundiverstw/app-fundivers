import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePWAInstall } from '../../hooks/usePWAInstall'
import type { PendingBookingDraft } from '../register/RegisterForm'

const navItems = [
  { to: '/dashboard', label: 'Home', icon: '🫧' },
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/bookings', label: 'Bookings', icon: '🤿' },
  { to: '/payments', label: 'Payments', icon: '💳' },
  { to: '/profile', label: 'Profile', icon: '👤' },
]

export function AppShell() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { canInstall, install } = usePWAInstall()

  // Diver returned via the email-confirmation link but landed somewhere
  // other than /register/<type>/<id> (e.g. site root, because the URL
  // allowlist redirected to Site URL instead of emailRedirectTo). The
  // pending_booking draft is on user_metadata; nudge them back to the
  // register URL where the auto-resume effect picks it up and inserts.
  const meta = (user?.user_metadata ?? {}) as { pending_booking?: PendingBookingDraft }
  const pending = meta.pending_booking
  const onRegisterRoute = pathname.startsWith('/register/')

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top bar */}
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-sky-400 text-lg">FunDivers TW</span>
        <div className="flex items-center gap-3">
          {canInstall && (
            <button
              onClick={install}
              className="text-xs bg-sky-500 hover:bg-sky-600 text-white px-2 py-1 rounded-md transition-colors"
            >
              Install app
            </button>
          )}
          {profile?.role === 'admin' && (
            <Link to="/admin" className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
              View as admin
            </Link>
          )}
          <span className="text-sm text-slate-400">{profile?.display_name ?? profile?.full_name}</span>
          <button
            onClick={handleSignOut}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-4 pb-24">
        {pending && !onRegisterRoute && (
          <div className="mb-4 bg-amber-950/40 border border-amber-700/60 rounded-xl p-3 flex items-center justify-between gap-3">
            <div className="text-sm text-amber-200">
              <p className="font-semibold">Finish your registration</p>
              <p className="text-xs text-amber-300/80 mt-0.5">
                You started signing up for <strong>{pending.event_title}</strong>. Tap below to complete it.
              </p>
            </div>
            <Link
              to={`/register/${pending.event_type}/${pending.event_id}`}
              className="shrink-0 bg-amber-500 hover:bg-amber-400 text-slate-900 text-xs font-semibold px-3 py-2 rounded-lg"
            >
              Finish
            </Link>
          </div>
        )}
        <Outlet />
      </main>

      {/* Bottom nav (mobile-first) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 flex justify-around py-2">
        {navItems.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
                isActive ? 'text-sky-400' : 'text-slate-400 hover:text-slate-200'
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
