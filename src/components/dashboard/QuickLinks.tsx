import { Link } from 'react-router-dom'
import { TrustedPartnersIcon } from '../icons/TrustedPartnersIcon'
import { PackagesIcon } from '../icons/PackagesIcon'
import { ScheduledTripsIcon } from '../icons/ScheduledTripsIcon'
import { MapIcon } from '../icons/MapIcon'
import { AlmanacIcon } from '../icons/AlmanacIcon'
import { t } from '../../i18n'
import { CARD, TEXT_BODY, TEXT_SUBTLE } from '../../styles/tokens'

// These four lived as bare icons in the diver header, where they were unlabelled
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
]

interface QuickLinksProps {
  /** Where the dive-site map tile goes. Undefined when the viewer may not open
   *  it yet — the tile then renders greyed out rather than as a link to a page
   *  they would be turned away from. */
  siteMapTo?: string
}

export function QuickLinks({ siteMapTo }: QuickLinksProps = {}) {
  return (
    <nav aria-label={t.dashboard.quickLinks} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {destinations.map(({ to, label, icon }) => (
        <Link key={to} to={to} className={`${TILE} ${TEXT_BODY}`}>
          {icon}
          <span className="text-xs leading-tight">{label}</span>
        </Link>
      ))}
      {siteMapTo ? (
        <Link to={siteMapTo} className={`${TILE} ${TEXT_BODY}`}>
          <MapIcon />
          <span className="text-xs leading-tight">{t.dashboard.siteMaps}</span>
        </Link>
      ) : (
        <div className={`${TILE} ${TEXT_SUBTLE} cursor-not-allowed opacity-60`} aria-disabled="true">
          <MapIcon />
          <span className="text-xs leading-tight">{t.dashboard.siteMaps}</span>
          <span className="text-[10px] uppercase tracking-wide opacity-80">
            {t.dashboard.comingSoon}
          </span>
        </div>
      )}
    </nav>
  )
}
