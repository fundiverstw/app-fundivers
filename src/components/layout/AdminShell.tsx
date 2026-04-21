import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

const adminNav = [
  { to: '/admin',        label: 'Dashboard', icon: '📊' },
  { to: '/admin/events', label: 'Events',    icon: '🗓️' },
  { to: '/admin/users',  label: 'Divers',    icon: '🤿' },
]

export function AdminShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      <header className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-sky-400 text-lg">
          FunDivers TW <span className="text-xs text-amber-400 font-normal align-middle">admin</span>
        </span>
        <div className="flex items-center gap-3">
          <Link to="/calendar" className="text-xs text-slate-400 hover:text-slate-100">View as diver</Link>
          <span className="text-sm text-slate-400">{profile?.display_name ?? profile?.full_name}</span>
          <button
            onClick={handleSignOut}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 pb-24">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 flex justify-around py-2">
        {adminNav.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/admin'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-xs transition-colors ${
                isActive ? 'text-amber-400' : 'text-slate-400 hover:text-slate-200'
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
