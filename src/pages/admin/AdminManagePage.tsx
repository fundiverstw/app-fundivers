import { Link } from 'react-router-dom'
import { t } from '../../i18n'

// Hub for the admin "Manage" tab. Each card links to a focused
// create/edit/delete page for one catalog entity:
//   - events (dives + courses) — uses the existing EventForm
//   - room options (rooms)
//   - add-ons (addons)
//   - trip_templates entries
//
// Keeping the hub flat (no nested grouping) so the small set of options
// stays scannable on a phone.

interface ManageCard {
  to: string
  title: string
  blurb: string
}

const m = t.admin.manage
const CARDS: ManageCard[] = [
  { to: '/admin/applications', ...m.applications },
  { to: '/admin/dashboard', ...m.dashboard },
  { to: '/admin/new/event', ...m.newEvent },
  { to: '/admin/rooms', ...m.rooms },
  { to: '/admin/addons', ...m.addons },
  { to: '/admin/travel', ...m.travel },
  { to: '/admin/destinations', ...m.destinations },
  { to: '/admin/prices', ...m.prices },
  { to: '/admin/vehicles', ...m.vehicles },
  { to: '/admin/gear-sizing', ...m.gearSizing },
  { to: '/admin/packages', ...m.packages },
  { to: '/admin/scheduled-trips', ...m.scheduledTrips },
  { to: '/admin/trusted-partners', ...m.trustedPartners },
  { to: '/admin/notifications', ...m.notifications },
  { to: '/admin/accounting', ...m.accounting },
  { to: '/admin/waivers', ...m.waivers },
  { to: '/admin/cancellation-policies', ...m.cancellationPolicies },
]

export function AdminManagePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">{t.admin.manage.title}</h1>
      <ul className="space-y-3">
        {CARDS.map(c => (
          <li key={c.to}>
            <Link
              to={c.to}
              className="block bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 hover:bg-white/90 transition-colors"
            >
              <p className="font-semibold text-brand-900">{c.title}</p>
              <p className="text-sm text-brand-900/80 mt-1">{c.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
