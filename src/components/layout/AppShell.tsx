import { useState } from 'react'
import { personName } from '../../lib/names'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { usePWAInstall } from '../../hooks/usePWAInstall'
import { IOSInstallModal } from '../install/IOSInstallModal'
import { WelcomeModal } from '../welcome/WelcomeModal'
import { Logo } from '../Logo'
import { CalendarIcon } from '../icons/CalendarIcon'
import { ChatIcon } from '../icons/ChatIcon'
import { CrosshairIcon } from '../icons/CrosshairIcon'
import { MapIcon } from '../icons/MapIcon'
import { PartnerConnectIcon } from '../icons/PartnerConnectIcon'
import { PersonIcon } from '../icons/PersonIcon'
import { NotificationBell } from '../NotificationBell'
import {
  PAGE, NAV_BAR, NAV_BOTTOM, BTN_LIGHT,
  ON_DEEP_MUTED, ON_DEEP_SUBTLE, ON_DEEP_BODY,
} from '../../styles/tokens'

function RecordsIcon() {
  // Logbook glyph — a bound book with a few pages — represents the consolidated
  // Records tab (bookings + payments + dive logs).
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

const baseNavItems: Array<{ to: string; label: string; icon: React.ReactNode }> = [
  { to: '/calendar', label: 'Calendar', icon: <CalendarIcon /> },
  { to: '/records',  label: 'Records',  icon: <RecordsIcon /> },
  { to: '/profile',  label: 'Profile',  icon: <PersonIcon /> },
  { to: '/contact',  label: 'Contact',  icon: <ChatIcon /> },
]

// "Duty" appears for staff/admin only — divers never have rows in
// duties (the assignee trigger blocks them).
const dutyNavItem = { to: '/duties', label: 'Duty', icon: <CrosshairIcon /> }

export function AppShell() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { canInstall, install, isIOSInstallable } = usePWAInstall()
  const [showIOSInstall, setShowIOSInstall] = useState(false)
  // Local override so the modal hides immediately on dismiss; the
  // server-side welcomed_at update propagates a moment later.
  const [welcomedLocally, setWelcomedLocally] = useState(false)
  const showWelcome = !!user && !welcomedLocally && !user.user_metadata?.welcomed_at
  const showInstallButton = canInstall || isIOSInstallable

  function handleInstallClick() {
    if (canInstall) install()
    else if (isIOSInstallable) setShowIOSInstall(true)
  }

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
            // CSS mask makes the PNG act as a stencil for an exact red fill
            // — `filter: hue-rotate` couldn't pin a specific shade and
            // multi-color PNGs end up muddy. The PNG is square so h == w.
            className="block h-6 w-6 bg-red-500 hover:bg-red-400 transition-colors"
            style={{
              WebkitMaskImage: 'url(/imgs/broadcast.png)',
              maskImage: 'url(/imgs/broadcast.png)',
              WebkitMaskSize: 'contain',
              maskSize: 'contain',
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              WebkitMaskPosition: 'center',
              maskPosition: 'center',
            }}
          />
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
          <Link
            to="/partner-connect"
            aria-label="Partner Connect (PX)"
            className="text-red-500 hover:text-red-400 transition-colors"
          >
            <PartnerConnectIcon />
          </Link>
          {showInstallButton && (
            <button onClick={handleInstallClick} className={`text-xs px-2 py-1 rounded-md ${BTN_LIGHT}`}>
              Install app
            </button>
          )}
          <NotificationBell />
          {profile?.role === 'admin' || profile?.role === 'staff' ? (
            <Link to={profile.role === 'admin' ? '/admin' : '/admin/events'} className={`text-sm ${ON_DEEP_BODY} hover:text-white`}>
              {personName(profile.name, profile.nickname)}
            </Link>
          ) : (
            <span className={`text-sm ${ON_DEEP_BODY}`}>{personName(profile?.name, profile?.nickname)}</span>
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
      {showIOSInstall && <IOSInstallModal onDismiss={() => setShowIOSInstall(false)} />}

      <nav className={NAV_BOTTOM}>
        {(profile?.role === 'admin' || profile?.role === 'staff'
          ? [...baseNavItems, dutyNavItem]
          : baseNavItems
        ).map(({ to, label, icon }) => (
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
