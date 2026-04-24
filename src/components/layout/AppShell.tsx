import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePWAInstall } from '../../hooks/usePWAInstall'
import { WelcomeModal } from '../welcome/WelcomeModal'
import { Logo } from '../Logo'
import {
  PAGE, NAV_BAR, NAV_BOTTOM, BTN_LIGHT,
  ON_DEEP_MUTED, ON_DEEP_SUBTLE, ON_DEEP_BODY, ON_DEEP_LINK,
} from '../../styles/tokens'

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
  const { canInstall, install } = usePWAInstall()
  // Local override so the modal hides immediately on dismiss; the
  // server-side welcomed_at update propagates a moment later.
  const [welcomedLocally, setWelcomedLocally] = useState(false)
  const showWelcome = !!user && !welcomedLocally && !user.user_metadata?.welcomed_at

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className={`min-h-screen ${PAGE} flex flex-col`}>
      <header className={NAV_BAR}>
        <Logo size="sm" />
        <div className="flex items-center gap-3">
          {canInstall && (
            <button onClick={install} className={`text-xs px-2 py-1 rounded-md ${BTN_LIGHT}`}>
              Install app
            </button>
          )}
          {profile?.role === 'admin' && (
            <Link to="/admin" className={`text-xs ${ON_DEEP_LINK}`}>
              View as admin
            </Link>
          )}
          <span className={`text-sm ${ON_DEEP_BODY}`}>{profile?.display_name ?? profile?.full_name}</span>
          <button onClick={handleSignOut} className={`text-xs ${ON_DEEP_MUTED} hover:text-white`}>
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-24">
        <Outlet />
      </main>

      {showWelcome && user && <WelcomeModal user={user} onDismiss={() => setWelcomedLocally(true)} />}

      <nav className={NAV_BOTTOM}>
        {navItems.map(({ to, label, icon }) => (
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
