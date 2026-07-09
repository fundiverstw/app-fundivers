import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchPackageBoard, fetchMyPackageRegistrations } from '../lib/packages'
import { errorMessage } from '../lib/errors'
import { siteConfig } from '../config/site'
import type { PackageBoardItem, MyPackageRegistration } from '../types/database'
import {
  CARD, PAGE_HEADING, PAGE_BODY, ON_DEEP_LINK, TEXT_HEADING, TEXT_SUBTLE,
} from '../styles/tokens'
import { t } from '../i18n'

const pk = t.packages

// Packages (diver-facing) — partner-shop dive trips we vouch for. Booking is at
// the partner shop; registering here builds an order (tier + dates + extras),
// emails a recommendation to the shop and to you, and shows an estimate.
// Complements Trusted Partners (the pull side: name a destination, we suggest a shop).
export function PackagesPage() {
  const [packages, setPackages] = useState<PackageBoardItem[]>([])
  const [registrations, setRegistrations] = useState<MyPackageRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [p, r] = await Promise.all([fetchPackageBoard(), fetchMyPackageRegistrations()])
        if (cancelled) return
        setPackages(p)
        setRegistrations(r)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // A diver has one live registration per package at most (the one-live index).
  const liveByPackage = new Map(
    registrations.filter(r => r.status !== 'cancelled').map(r => [r.package_id, r]),
  )

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>{pk.title}</h1>
        <p className={`text-sm ${PAGE_BODY}`}>{pk.intro}</p>
        <p className="text-sm">
          <Link to="/trusted-partners" className={ON_DEEP_LINK}>
            {pk.trustedPartnersLink}
          </Link>
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      )}

      {loading ? (
        <p className={`text-sm ${PAGE_BODY}`}>{pk.loading}</p>
      ) : packages.length === 0 ? (
        <p className={`text-sm ${PAGE_BODY}`}>{pk.none}</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {packages.map(pkg => (
            <li key={pkg.id}>
              <PackageCard pkg={pkg} registration={liveByPackage.get(pkg.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PackageCard({ pkg, registration }: { pkg: PackageBoardItem; registration: MyPackageRegistration | null }) {
  return (
    <Link to={`/packages/${pkg.id}`} className={`${CARD} block overflow-hidden hover:bg-white/90 transition-colors h-full`}>
      {pkg.hero_image_url ? (
        <img src={pkg.hero_image_url} alt="" className="w-full h-36 object-cover" />
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-surface-200 to-brand-300" />
      )}
      <div className="p-3 space-y-1">
        <p className={`text-sm ${TEXT_HEADING} truncate`}>{pkg.title}</p>
        <p className={`text-xs ${TEXT_SUBTLE} truncate`}>{pkg.destination}</p>
        <div className="flex items-center justify-between pt-1 gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-400 bg-emerald-50 text-emerald-800 font-medium truncate">
            {pk.inCooperationWith(pkg.partner_name)}
          </span>
          {pkg.min_price != null && (
            <span className={`text-xs ${TEXT_HEADING} shrink-0`}>
              {pk.fromPrice(pkg.min_price.toLocaleString(), pkg.currency)}
            </span>
          )}
        </div>
        {registration && (
          <p className="text-xs text-brand-800 font-semibold pt-1">
            {registration.status === 'registered' ? pk.youreRegistered : pk.registrationStatus(registration.status)}
            {registration.estimated_cost != null && pk.estShort(
              registration.estimated_cost.toLocaleString(),
              registration.estimated_currency ?? siteConfig.locale.currency,
            )}
          </p>
        )}
      </div>
    </Link>
  )
}
