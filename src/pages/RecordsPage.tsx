import { NavLink, Outlet } from 'react-router-dom'

// Records is a thin shell — a horizontal tab strip and an <Outlet/> for the
// active sub-page. Bookings, Payments and (eventually) Dive Logs live here so
// the bottom nav stays at three diver-facing tabs (Calendar / Records /
// Profile) instead of crowding past four.
//
// Sub-pages own their own H1, so this shell deliberately renders no outer
// heading — the active tab's H1 reads as the section title.

const TABS = [
  { to: 'bookings',  label: 'Bookings' },
  { to: 'payments',  label: 'Payments' },
  { to: 'dive-logs', label: 'Dive log' },
]

export function RecordsPage() {
  return (
    <div className="space-y-4">
      <nav
        aria-label="Records sections"
        className="flex gap-2 sticky top-0 z-10 bg-brand-900/85 backdrop-blur-md -mx-4 px-4 py-2 border-b border-accent/40"
      >
        {TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `px-3 py-1 rounded-full text-sm transition-colors ${
                isActive
                  ? 'bg-white text-brand-950 font-semibold'
                  : 'text-white/80 hover:text-white hover:bg-white/10'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
