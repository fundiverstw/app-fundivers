import { Link } from 'react-router-dom'
import { t } from '../../i18n'

// Hub for the admin "Manage" tab. The catalog/settings pages have grown past a
// scannable flat list, so cards are chunked into labelled sections and laid out
// in a responsive grid (one column on a phone, two from `sm` up). Each card
// links to a focused create/edit/delete page for one entity.

interface ManageCard {
  to: string
  title: string
  blurb: string
}

interface ManageGroup {
  title: string
  cards: ManageCard[]
}

const m = t.admin.manage
const GROUPS: ManageGroup[] = [
  {
    title: m.groups.overview,
    cards: [
      { to: '/admin/dashboard', ...m.dashboard },
      { to: '/admin/applications', ...m.applications },
    ],
  },
  {
    title: m.groups.eventsTrips,
    cards: [
      { to: '/admin/new/event', ...m.newEvent },
      { to: '/admin/scheduled-trips', ...m.scheduledTrips },
      { to: '/admin/packages', ...m.packages },
      { to: '/admin/destinations', ...m.destinations },
      { to: '/admin/travel', ...m.travel },
    ],
  },
  {
    title: m.groups.catalogLogistics,
    cards: [
      { to: '/admin/prices', ...m.prices },
      { to: '/admin/rooms', ...m.rooms },
      { to: '/admin/addons', ...m.addons },
      { to: '/admin/vehicles', ...m.vehicles },
      { to: '/admin/gear-sizing', ...m.gearSizing },
    ],
  },
  {
    title: m.groups.legalPolicies,
    cards: [
      { to: '/admin/waivers', ...m.waivers },
      { to: '/admin/terms', ...m.terms },
      { to: '/admin/cancellation-policies', ...m.cancellationPolicies },
    ],
  },
  {
    title: m.groups.partnersComms,
    cards: [
      { to: '/admin/trusted-partners', ...m.trustedPartners },
      { to: '/admin/notifications', ...m.notifications },
      { to: '/admin/accounting', ...m.accounting },
    ],
  },
]

export function AdminManagePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-white">{m.title}</h1>
      {GROUPS.map(group => (
        <section key={group.title} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">{group.title}</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {group.cards.map(c => (
              <li key={c.to} className="flex">
                <Link
                  to={c.to}
                  className="flex-1 bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 hover:bg-white/90 transition-colors"
                >
                  <p className="font-semibold text-brand-900">{c.title}</p>
                  <p className="text-sm text-brand-900/80 mt-1">{c.blurb}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
