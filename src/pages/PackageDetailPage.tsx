import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchPackageBoardItem, fetchPackageTiers, fetchMyPackageRegistrations, cancelMyPackageRegistration,
  registerForPackage,
} from '../lib/packages'
import { errorMessage } from '../lib/errors'
import { useToast } from '../hooks/useToast'
import { packageDateLabel } from '../lib/package-format'
import { siteConfig } from '../config/site'
import { RegisterWizard } from '../components/register/RegisterWizard'
import type { PackageBoardItem, PackageTierItem, MyPackageRegistration } from '../types/database'
import {
  CARD, BTN_PRIMARY, BTN_DANGER, PAGE_BODY, TEXT_LINK, ON_DEEP_LINK, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE,
} from '../styles/tokens'

// Package detail — full pitch for one partner package, its price tiers, and the
// registration flow. Registering builds an order (tier + dates + extras) and
// emails a recommendation to the partner shop and the diver with a cost estimate.
export function PackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const [pkg, setPkg] = useState<PackageBoardItem | null>(null)
  const [tiers, setTiers] = useState<PackageTierItem[]>([])
  const [registration, setRegistration] = useState<MyPackageRegistration | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const [p, ts, regs] = await Promise.all([
          fetchPackageBoardItem(id), fetchPackageTiers(id), fetchMyPackageRegistrations(),
        ])
        if (cancelled) return
        setPkg(p)
        setTiers(ts)
        setRegistration(regs.find(r => r.package_id === id && r.status !== 'cancelled') ?? null)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  async function refreshRegistration() {
    if (!id) return
    const regs = await fetchMyPackageRegistrations()
    setRegistration(regs.find(r => r.package_id === id && r.status !== 'cancelled') ?? null)
  }

  async function handleCancel() {
    if (!registration) return
    setCancelling(true)
    try {
      await cancelMyPackageRegistration(registration.id)
      await refreshRegistration()
      toast.success('Registration cancelled.')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCancelling(false)
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
          <p className={`text-sm ${TEXT_SUBTLE}`}>{pkg.destination}</p>
          <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-emerald-400 bg-emerald-50 text-emerald-800 font-medium">
            In cooperation with {pkg.partner_name}
          </span>
          {pkg.summary && <p className={`text-sm ${TEXT_BODY}`}>{pkg.summary}</p>}
        </div>
      </div>

      {tiers.length > 0 && (
        <section className={`${CARD} p-4 space-y-1`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>Packages</h2>
          <ul className="space-y-1">
            {tiers.map(t => (
              <li key={t.id} className="flex justify-between text-sm">
                <span className={TEXT_BODY}>{t.name}</span>
                <span className={TEXT_HEADING}>{t.price.toLocaleString()} {t.currency}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      {registration ? (
        <RegisteredCard registration={registration} onCancel={handleCancel} cancelling={cancelling} />
      ) : (
        <section className={`${CARD} p-4 space-y-2`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>Interested?</h2>
          <p className={`text-sm ${TEXT_BODY}`}>
            Pick a package and your dates and we’ll recommend you to {pkg.partner_name} with a
            cost estimate. No payment here — the final cost is set by the shop.
          </p>
          <button type="button" onClick={() => setFormOpen(true)} disabled={tiers.length === 0}
            className={`${BTN_PRIMARY} disabled:opacity-50`}>
            {tiers.length === 0 ? 'No packages available' : 'Register'}
          </button>
        </section>
      )}

      {formOpen && (
        <RegisterWizard
          title={pkg.title}
          subtitle={`with ${pkg.partner_name}`}
          currency={pkg.currency}
          tiers={tiers}
          baseLabel="Package"
          dateMode="pick"
          addonIds={pkg.addon_ids}
          roomTypeIds={pkg.room_type_ids}
          disclaimer="This is an estimate only — the final cost will be determined by the partner shop."
          onSubmit={(sel) => registerForPackage({
            packageId: pkg.id,
            tierId: sel.tierId ?? tiers[0]?.id ?? '',
            preferredStart: sel.start,
            preferredEnd: sel.end,
            addonIds: sel.addonIds,
            roomId: sel.roomId,
            notes: sel.notes,
          })}
          onClose={() => setFormOpen(false)}
          onRegistered={async (result) => {
            setFormOpen(false)
            await refreshRegistration()
            if (result.already_registered) {
              toast.success('You already have a live registration for this package.')
            } else if (result.emailed) {
              toast.success('You’re registered — we’ve emailed the shop and you a summary.')
            } else {
              toast.success('You’re registered — we’ll pass your details to the shop.')
            }
          }}
        />
      )}
    </div>
  )
}

function RegisteredCard({ registration, onCancel, cancelling }: {
  registration: MyPackageRegistration
  onCancel: () => void
  cancelling: boolean
}) {
  const dates = packageDateLabel(registration.preferred_start, registration.preferred_end)
  return (
    <section className={`${CARD} p-4 space-y-2`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>You’re registered</h2>
      <p className={`text-sm ${TEXT_BODY}`}>
        {registration.tier_name ?? 'Package'}{dates ? ` · ${dates}` : ''}
      </p>
      {registration.estimated_cost != null && (
        <p className={`text-sm ${TEXT_HEADING}`}>
          Estimated cost: {registration.estimated_cost.toLocaleString()}{' '}
          {registration.estimated_currency ?? siteConfig.locale.currency}
        </p>
      )}
      <p className={`text-xs ${TEXT_SUBTLE}`}>
        The final cost is determined by the partner shop. Status: {registration.status}
      </p>
      <button type="button" onClick={onCancel} disabled={cancelling} className={`${BTN_DANGER} disabled:opacity-50`}>
        {cancelling ? 'Cancelling…' : 'Cancel registration'}
      </button>
    </section>
  )
}

function BackLink() {
  return <Link to="/packages" className={`text-sm ${ON_DEEP_LINK}`}>← Packages</Link>
}
