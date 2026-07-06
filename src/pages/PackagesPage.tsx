import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchPackageBoard, fetchMyPackageReferrals } from '../lib/packages'
import { packageDateLabel } from '../lib/package-format'
import { errorMessage } from '../lib/errors'
import type { PackageBoardItem, MyPackageReferral } from '../types/database'
import {
  CARD, PAGE_HEADING, PAGE_BODY, ON_DEEP_LINK, TEXT_HEADING, TEXT_SUBTLE,
} from '../styles/tokens'

// Packages (diver-facing) — the curated travel packages abroad we vouch for.
// Booking happens at the partner shop; expressing interest here mints a referral
// code and we broker the intro. Complements Trusted Partners (the pull side: a
// diver names a destination and we suggest a shop).
export function PackagesPage() {
  const [packages, setPackages] = useState<PackageBoardItem[]>([])
  const [referrals, setReferrals] = useState<MyPackageReferral[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [p, r] = await Promise.all([fetchPackageBoard(), fetchMyPackageReferrals()])
        if (cancelled) return
        setPackages(p)
        setReferrals(r)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const referralByPackage = new Map(referrals.map(r => [r.package_id, r]))

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>Packages</h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          Dive trips abroad we've personally vetted. Tap one you like — we'll
          give you a reference code and connect you with the shop directly.
        </p>
        <p className="text-sm">
          <Link to="/trusted-partners" className={ON_DEEP_LINK}>
            Headed somewhere not listed? Try Trusted Partners →
          </Link>
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      )}

      {loading ? (
        <p className={`text-sm ${PAGE_BODY}`}>Loading…</p>
      ) : packages.length === 0 ? (
        <p className={`text-sm ${PAGE_BODY}`}>No packages on the board right now — check back soon.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {packages.map(pkg => (
            <li key={pkg.id}>
              <PackageCard pkg={pkg} referral={referralByPackage.get(pkg.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PackageCard({ pkg, referral }: { pkg: PackageBoardItem; referral: MyPackageReferral | null }) {
  const dates = packageDateLabel(pkg.start_date, pkg.end_date)
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
        {dates && <p className={`text-xs ${TEXT_SUBTLE}`}>{dates}</p>}
        <div className="flex items-center justify-between pt-1 gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-400 bg-emerald-50 text-emerald-800 font-medium truncate">
            In cooperation with {pkg.partner_name}
          </span>
          {pkg.price != null && (
            <span className={`text-xs ${TEXT_HEADING} shrink-0`}>{pkg.price.toLocaleString()} {pkg.currency}</span>
          )}
        </div>
        {referral && (
          <p className="text-xs text-brand-800 font-semibold pt-1">
            {referral.status === 'interested' ? 'You’re interested' : `Referral: ${referral.status}`} · {referral.referral_code}
          </p>
        )}
      </div>
    </Link>
  )
}
