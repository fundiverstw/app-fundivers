import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from '../Logo'
import {
  PAGE, NAV_BAR, NAV_BOTTOM,
  ON_DEEP_MUTED, ON_DEEP_SUBTLE, ON_DEEP_BODY,
} from '../../styles/tokens'

const adminNav = [
  { to: '/admin',        label: 'Home',      icon: '🫧' },
  { to: '/admin/events', label: 'Events',    icon: '🗓️' },
  { to: '/admin/users',  label: 'Divers',    icon: '🤿' },
  { to: '/admin/duty',   label: 'Duty',      icon: '🛟' },
]

export function AdminShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className={`min-h-screen ${PAGE} flex flex-col`}>
      <header className={NAV_BAR}>
        <div className="flex items-center gap-2">
          <Logo size="sm" />
          <span className="text-xs text-red-300 font-medium uppercase tracking-wider">admin</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/calendar" className={`text-xs ${ON_DEEP_MUTED} hover:text-white`}>View as diver</Link>
          <span className={`text-sm ${ON_DEEP_BODY}`}>{profile?.display_name ?? profile?.full_name}</span>
          <button onClick={handleSignOut} className={`text-xs ${ON_DEEP_MUTED} hover:text-white`}>
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-24">
        <Outlet />
      </main>

      <nav className={NAV_BOTTOM}>
        {adminNav.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin'}
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
