import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { t } from '../../i18n'
import { ChartIcon } from '../../components/icons/ChartIcon'
import { ClipboardCheckIcon } from '../../components/icons/ClipboardCheckIcon'
import { PlusCircleIcon } from '../../components/icons/PlusCircleIcon'
import { ScheduledTripsIcon } from '../../components/icons/ScheduledTripsIcon'
import { PackagesIcon } from '../../components/icons/PackagesIcon'
import { MapPinIcon } from '../../components/icons/MapPinIcon'
import { LayoutIcon } from '../../components/icons/LayoutIcon'
import { TagIcon } from '../../components/icons/TagIcon'
import { BedIcon } from '../../components/icons/BedIcon'
import { PlusSquareIcon } from '../../components/icons/PlusSquareIcon'
import { TruckIcon } from '../../components/icons/TruckIcon'
import { RulerIcon } from '../../components/icons/RulerIcon'
import { FileSignatureIcon } from '../../components/icons/FileSignatureIcon'
import { FileTextIcon } from '../../components/icons/FileTextIcon'
import { ShieldCheckIcon } from '../../components/icons/ShieldCheckIcon'
import { TrustedPartnersIcon } from '../../components/icons/TrustedPartnersIcon'
import { BellIcon } from '../../components/icons/BellIcon'
import { DownloadIcon } from '../../components/icons/DownloadIcon'

// Hub for the admin "Manage" tab. The catalog/settings pages have grown past a
// scannable flat list, so cards are chunked into labelled sections and shown as
// an icon grid (two columns on a phone, three from `sm` up). Each card is an
// icon + title; the longer description is kept as the link's hover tooltip so
// the grid stays compact without losing the explanation.

interface ManageCard {
  to: string
  title: string
  blurb: string
  icon: ReactNode
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
      { to: '/admin/dashboard', icon: <ChartIcon />, ...m.dashboard },
      { to: '/admin/applications', icon: <ClipboardCheckIcon />, ...m.applications },
    ],
  },
  {
    title: m.groups.eventsTrips,
    cards: [
      { to: '/admin/new/event', icon: <PlusCircleIcon />, ...m.newEvent },
      { to: '/admin/scheduled-trips', icon: <ScheduledTripsIcon />, ...m.scheduledTrips },
      { to: '/admin/packages', icon: <PackagesIcon />, ...m.packages },
      { to: '/admin/destinations', icon: <MapPinIcon />, ...m.destinations },
      { to: '/admin/travel', icon: <LayoutIcon />, ...m.travel },
    ],
  },
  {
    title: m.groups.catalogLogistics,
    cards: [
      { to: '/admin/prices', icon: <TagIcon />, ...m.prices },
      { to: '/admin/rooms', icon: <BedIcon />, ...m.rooms },
      { to: '/admin/addons', icon: <PlusSquareIcon />, ...m.addons },
      { to: '/admin/vehicles', icon: <TruckIcon />, ...m.vehicles },
      { to: '/admin/gear-sizing', icon: <RulerIcon />, ...m.gearSizing },
    ],
  },
  {
    title: m.groups.legalPolicies,
    cards: [
      { to: '/admin/waivers', icon: <FileSignatureIcon />, ...m.waivers },
      { to: '/admin/terms', icon: <FileTextIcon />, ...m.terms },
      { to: '/admin/cancellation-policies', icon: <ShieldCheckIcon />, ...m.cancellationPolicies },
    ],
  },
  {
    title: m.groups.partnersComms,
    cards: [
      { to: '/admin/trusted-partners', icon: <TrustedPartnersIcon />, ...m.trustedPartners },
      { to: '/admin/notifications', icon: <BellIcon />, ...m.notifications },
      { to: '/admin/accounting', icon: <DownloadIcon />, ...m.accounting },
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
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {group.cards.map(c => (
              <li key={c.to} className="flex">
                <Link
                  to={c.to}
                  title={c.blurb}
                  className="flex-1 flex flex-col items-center text-center gap-2 bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 hover:bg-white/90 transition-colors"
                >
                  <span className="text-brand-700" aria-hidden="true">{c.icon}</span>
                  <span className="text-sm font-semibold text-brand-900 leading-tight">{c.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
