import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePWAInstall } from '../../hooks/usePWAInstall'

const navItems = [
  { to: '/calendar', label: 'Calendar', icon: '📅' },
  { to: '/bookings', label: 'My Bookings', icon: '🤿' },
  { to: '/payments', label: 'Payments', icon: '💳' },
  { to: '/profile', label: 'Profile', icon: '👤' },
]

export function AppShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { canInstall, install } = usePWAInstall()

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
