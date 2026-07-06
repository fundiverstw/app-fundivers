import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchPackageBoardItem, fetchMyPackageReferrals, expressPackageInterest } from '../lib/packages'
import { errorMessage } from '../lib/errors'
import { useToast } from '../hooks/useToast'
import { packageDateLabel } from '../lib/package-format'
import type { PackageBoardItem, MyPackageReferral } from '../types/database'
import {
  CARD, BTN_PRIMARY, PAGE_BODY, TEXT_LINK, ON_DEEP_LINK, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE,
} from '../styles/tokens'

// Package detail — full pitch for one curated package, plus the "I'm interested"
// action that mints the diver's referral code. We broker the intro, so the
// code is the thread that ties the diver's eventual booking at the partner
// shop back to us for the kickback.
export function PackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const [pkg, setPkg] = useState<PackageBoardItem | null>(null)
  const [referral, setReferral] = useState<MyPackageReferral | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const [p, refs] = await Promise.all([fetchPackageBoardItem(id), fetchMyPackageReferrals()])
        if (cancelled) return
        setPkg(p)
        setReferral(refs.find(r => r.package_id === id) ?? null)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  async function handleInterest() {
    if (!id) return
    setSubmitting(true)
    try {
      const code = await expressPackageInterest(id)
      // Reflect the new (or existing) referral without a full refetch.
      const refs = await fetchMyPackageReferrals()
      setReferral(refs.find(r => r.package_id === id) ?? { id: '', package_id: id, referral_code: code, status: 'interested', created_at: '', package_title: pkg?.title ?? '', package_destination: pkg?.destination ?? '', partner_name: pkg?.partner_name ?? '' })
      toast.success('We’ve got it — we’ll be in touch to connect you.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <p className={`text-sm ${PAGE_BODY} max-w-2xl mx-auto`}>Loading…</p>
  if (error) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <BackLink />
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      </div>
    )
  }
  if (!pkg) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <BackLink />
        <p className={`text-sm ${PAGE_BODY}`}>This package isn’t on the board anymore.</p>
      </div>
    )
  }

  const dates = packageDateLabel(pkg.start_date, pkg.end_date)

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackLink />

      <div className={`${CARD} overflow-hidden`}>
        {pkg.hero_image_url ? (
          <img src={pkg.hero_image_url} alt="" className="w-full h-48 object-cover" />
        ) : (
          <div className="w-full h-48 bg-gradient-to-br from-surface-200 to-brand-300" />
        )}
        <div className="p-4 space-y-2">
          <h1 className={`text-xl ${TEXT_HEADING}`}>{pkg.title}</h1>
          <p className={`text-sm ${TEXT_SUBTLE}`}>
            {pkg.destination}{dates ? ` · ${dates}` : ''}
          </p>
          <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-emerald-400 bg-emerald-50 text-emerald-800 font-medium">
            In cooperation with {pkg.partner_name}
          </span>
          {pkg.price != null && (
            <p className={`text-sm ${TEXT_HEADING}`}>{pkg.price.toLocaleString()} {pkg.currency}</p>
          )}
          {pkg.summary && <p className={`text-sm ${TEXT_BODY}`}>{pkg.summary}</p>}
        </div>
      </div>

      {pkg.description && (
        <section className={`${CARD} p-4 space-y-1`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>About this package</h2>
          <p className={`text-sm ${TEXT_BODY} whitespace-pre-wrap`}>{pkg.description}</p>
        </section>
      )}

      {pkg.highlights.length > 0 && (
        <section className={`${CARD} p-4 space-y-1`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>Highlights</h2>
          <ul className="list-disc list-inside space-y-0.5">
            {pkg.highlights.map((h, i) => <li key={i} className={`text-sm ${TEXT_BODY}`}>{h}</li>)}
          </ul>
        </section>
      )}

      <section className={`${CARD} p-4 space-y-1`}>
        <h2 className={`text-sm ${TEXT_HEADING}`}>The shop we vouch for</h2>
        <p className={`text-sm ${TEXT_BODY}`}>
          {pkg.partner_name} · {[pkg.partner_location, pkg.partner_country].filter(Boolean).join(', ')}
        </p>
        {pkg.partner_vouch_notes && <p className={`text-sm ${TEXT_SUBTLE}`}>{pkg.partner_vouch_notes}</p>}
        {pkg.partner_website && (
          <a href={pkg.partner_website} target="_blank" rel="noopener noreferrer" className={`text-sm ${TEXT_LINK}`}>
            Visit their site →
          </a>
        )}
      </section>

      {referral ? (
        <InterestedCard pkg={pkg} referral={referral} />
      ) : (
        <section className={`${CARD} p-4 space-y-2`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>Interested?</h2>
          <p className={`text-sm ${TEXT_BODY}`}>
            Tap below and we’ll give you a reference code, then personally
            connect you with {pkg.partner_name}. No payment here — you book
            directly with the shop.
          </p>
          <button type="button" onClick={handleInterest} disabled={submitting} className={`${BTN_PRIMARY} disabled:opacity-50`}>
            {submitting ? 'Sending…' : 'I’m interested'}
          </button>
        </section>
      )}
    </div>
  )
}

function InterestedCard({ pkg, referral }: { pkg: PackageBoardItem; referral: MyPackageReferral }) {
  return (
    <section className={`${CARD} p-4 space-y-2`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>You’re on the list</h2>
      <p className={`text-sm ${TEXT_BODY}`}>
        We’ll be in touch to connect you with {pkg.partner_name}. When you
        book, mention this reference code so we’re credited:
      </p>
      <p className="text-lg font-bold tracking-wider text-brand-900 bg-surface-50 border border-surface-300 rounded-lg px-3 py-2 text-center">
        {referral.referral_code}
      </p>
      <p className={`text-xs ${TEXT_SUBTLE}`}>Status: {referral.status}</p>
      {pkg.booking_url && (
        <a href={pkg.booking_url} target="_blank" rel="noopener noreferrer" className={`${BTN_PRIMARY} inline-block text-center`}>
          Book on the partner’s site →
        </a>
      )}
    </section>
  )
}

function BackLink() {
  return <Link to="/packages" className={`text-sm ${ON_DEEP_LINK}`}>← Packages</Link>
}
