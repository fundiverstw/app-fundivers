import { Link } from 'react-router-dom'

// Hub for the admin "Manage" tab. Each card links to a focused
// create/edit/delete page for one catalog entity:
//   - events (dives + courses) — uses the existing EventForm
//   - room options (EO_rooms)
//   - add-ons (Other_Addons)
//   - DiveTravel entries
//
// Keeping the hub flat (no nested grouping) so the small set of options
// stays scannable on a phone.

interface ManageCard {
  to: string
  title: string
  blurb: string
}

const CARDS: ManageCard[] = [
  { to: '/admin/new/event', title: 'New event',     blurb: 'Create a dive or course. Edit existing events from the calendar.' },
  { to: '/admin/rooms',     title: 'Room options',  blurb: 'Add, rename, reprice or delete room types offered with multi-day dives.' },
  { to: '/admin/addons',    title: 'Add-ons',       blurb: 'Add, rename, reprice or delete optional items (gear, courses, transport).' },
  { to: '/admin/travel',    title: 'DiveTravel',    blurb: 'Add or edit "what’s included" and transportation copy used by EO_dives.' },
  { to: '/admin/prices',    title: 'Price tiers',   blurb: 'Total / deposit / transport for each event price tier.' },
]

export function AdminManagePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Manage</h1>
      <ul className="space-y-3">
        {CARDS.map(c => (
          <li key={c.to}>
            <Link
              to={c.to}
              className="block bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 hover:bg-white/90 transition-colors"
            >
              <p className="font-semibold text-blue-900">{c.title}</p>
              <p className="text-sm text-blue-900/80 mt-1">{c.blurb}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
