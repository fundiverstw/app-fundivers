import { Link } from 'react-router-dom'
import { TrustedPartnersIcon } from '../icons/TrustedPartnersIcon'
import { PackagesIcon } from '../icons/PackagesIcon'
import { ScheduledTripsIcon } from '../icons/ScheduledTripsIcon'
import { MapIcon } from '../icons/MapIcon'
import { CoralIcon } from '../icons/CoralIcon'
import { AlmanacIcon } from '../icons/AlmanacIcon'
import { t } from '../../i18n'
import { CARD, TEXT_BODY } from '../../styles/tokens'

// These lived as bare icons in the diver header, where they were unlabelled
// and competed with the notification bell for the same strip. On the home page
// there is room to name each one.
//
// Two columns on a phone rather than four: "Trusted Partners" and "Scheduled
// Trips" both wrap at 320px in a four-up grid, and a wrapped label under a
// 24px icon reads as broken rather than dense.
const TILE = `${CARD} flex flex-col items-center justify-center gap-1.5 px-2 py-3 text-center transition-colors`

interface Destination {
  to: string
  label: string
  icon: React.ReactNode
}

const destinations: Destination[] = [
  { to: '/trusted-partners', label: t.shell.trustedPartners, icon: <TrustedPartnersIcon /> },
  { to: '/packages',         label: t.shell.packages,        icon: <PackagesIcon /> },
  { to: '/scheduled-trips',  label: t.shell.scheduledTrips,  icon: <ScheduledTripsIcon /> },
  { to: '/almanac',          label: t.dashboard.almanac,     icon: <AlmanacIcon /> },
  { to: '/coral',            label: t.coral.title,           icon: <CoralIcon /> },
  // Was a greyed-out "coming soon" tile with a prop deciding whether it linked
  // anywhere, back when the map lived behind a development-only route. It is a
  // page now, open to every signed-in diver, so it is a destination like the
  // rest.
  { to: '/site-maps',        label: t.dashboard.siteMaps,    icon: <MapIcon /> },
]

export function QuickLinks() {
  return (
    <nav aria-label={t.dashboard.quickLinks} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {destinations.map(({ to, label, icon }) => (
        <Link key={to} to={to} className={`${TILE} ${TEXT_BODY}`}>
          {icon}
          <span className="text-xs leading-tight">{label}</span>
        </Link>
      ))}
    </nav>
  )
}
