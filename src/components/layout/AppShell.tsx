import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePWAInstall } from '../../hooks/usePWAInstall'
import { WelcomeModal } from '../welcome/WelcomeModal'
import { Logo } from '../Logo'
import { CalendarIcon } from '../icons/CalendarIcon'
import { MapIcon } from '../icons/MapIcon'
import {
  PAGE, NAV_BAR, NAV_BOTTOM, BTN_LIGHT,
  ON_DEEP_MUTED, ON_DEEP_SUBTLE, ON_DEEP_BODY,
} from '../../styles/tokens'

function DiveLogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4" width="17" height="16.5" rx="1.5" />
      <line x1="8.5" y1="4" x2="8.5" y2="20.5" />
      <path d="M11 11 q 1.5 -2 3 0 t 3 0" />
      <path d="M11 16 q 1.5 -2 3 0 t 3 0" />
    </svg>
  )
}

function DollarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="2.5" x2="12" y2="21.5" />
      <path d="M17 6.5H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H6.5" />
    </svg>
  )
}

const navItems: Array<{ to: string; label: string; icon: React.ReactNode }> = [
  { to: '/calendar', label: 'Calendar', icon: <CalendarIcon /> },
  { to: '/bookings', label: 'Bookings', icon: <DiveLogIcon /> },
  { to: '/payments', label: 'Payments', icon: <DollarIcon /> },
  { to: '/profile', label: 'Profile', icon: '🤿' },
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
        <div className="flex-1 flex items-center justify-start gap-4">
          <a
            href="https://radio.fundiverstw.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="FunDivers Radio"
          >
            <img src="/imgs/broadcast.png" alt="" className="h-8 w-auto" />
          </a>
          <a
            href="https://www.fundiverstw.com/weeklyspecial"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Weekly special"
          >
            <img src="/imgs/tanks.png" alt="" className="h-8 w-auto" />
          </a>
          <Link
            to="/map"
            aria-label="Dive site map"
            className="text-red-500 hover:text-red-400 transition-colors"
          >
            <MapIcon />
          </Link>
        </div>
        <Link to="/dashboard" aria-label="Home" className="shrink-0">
          <Logo size="sm" />
        </Link>
        <div className="flex-1 flex items-center justify-end gap-3">
          {canInstall && (
            <button onClick={install} className={`text-xs px-2 py-1 rounded-md ${BTN_LIGHT}`}>
              Install app
            </button>
          )}
          {profile?.role === 'admin' ? (
            <Link to="/admin" className={`text-sm ${ON_DEEP_BODY} hover:text-white`}>
              {profile.display_name ?? profile.full_name}
            </Link>
          ) : (
            <span className={`text-sm ${ON_DEEP_BODY}`}>{profile?.display_name ?? profile?.full_name}</span>
          )}
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
