import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchScheduledTrip, fetchMyScheduledTripRegistrations,
  registerForScheduledTrip, cancelMyScheduledTripRegistration,
} from '../lib/scheduled-trips'
import { errorMessage } from '../lib/errors'
import { useToast } from '../hooks/useToast'
import { packageDateLabel } from '../lib/package-format'
import { siteConfig } from '../config/site'
import { RegisterWizard } from '../components/register/RegisterWizard'
import type { ScheduledTripItem, MyScheduledTripRegistration } from '../types/database'
import {
  CARD, BTN_PRIMARY, BTN_DANGER, PAGE_BODY, ON_DEEP_LINK, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE,
} from '../styles/tokens'
import { t } from '../i18n'

const tr = t.trips
const pk = t.packages

// Scheduled Trip detail — the shop's own trip pitch + the self-contained
// registration. Registering builds an order (add-ons per day, room per night over
// the trip's fixed dates) and emails the shop + diver a cost estimate. Mirrors
// PackageDetailPage; the shop's own trip has no tiers/partner.
export function ScheduledTripDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const [trip, setTrip] = useState<ScheduledTripItem | null>(null)
  const [registration, setRegistration] = useState<MyScheduledTripRegistration | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const [t, regs] = await Promise.all([fetchScheduledTrip(id), fetchMyScheduledTripRegistrations()])
        if (cancelled) return
        setTrip(t)
        setRegistration(regs.find(r => r.scheduled_trip_id === id && r.status !== 'cancelled') ?? null)
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
    const regs = await fetchMyScheduledTripRegistrations()
    setRegistration(regs.find(r => r.scheduled_trip_id === id && r.status !== 'cancelled') ?? null)
  }

  async function handleCancel() {
    if (!registration) return
    setCancelling(true)
    try {
      await cancelMyScheduledTripRegistration(registration.id)
      await refreshRegistration()
      toast.success(pk.cancelled)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setCancelling(false)
    }
  }

  if (loading) return <p className={`text-sm ${PAGE_BODY} max-w-2xl mx-auto`}>{pk.loading}</p>
  if (error) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <BackLink />
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      </div>
    )
  }
  if (!trip) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <BackLink />
        <p className={`text-sm ${PAGE_BODY}`}>{tr.gone}</p>
      </div>
    )
  }

  const dates = packageDateLabel(trip.start_date, trip.end_date)

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <BackLink />

      <div className={`${CARD} overflow-hidden`}>
        {trip.hero_image_url ? (
          <img src={trip.hero_image_url} alt="" className="w-full h-48 object-cover" />
        ) : (
          <div className="w-full h-48 bg-gradient-to-br from-surface-200 to-brand-300" />
        )}
        <div className="p-4 space-y-2">
          <h1 className={`text-xl ${TEXT_HEADING}`}>{trip.title}</h1>
          <p className={`text-sm ${TEXT_SUBTLE}`}>{trip.destination}{dates ? ` · ${dates}` : ''}</p>
          {trip.price != null && (
            <p className={`text-sm ${TEXT_HEADING}`}>{pk.fromPrice(trip.price.toLocaleString(), trip.currency)}</p>
          )}
          {trip.summary && <p className={`text-sm ${TEXT_BODY}`}>{trip.summary}</p>}
        </div>
      </div>

      {trip.description && (
        <section className={`${CARD} p-4 space-y-1`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>{tr.aboutHeading}</h2>
          <p className={`text-sm ${TEXT_BODY} whitespace-pre-wrap`}>{trip.description}</p>
        </section>
      )}

      {trip.highlights.length > 0 && (
        <section className={`${CARD} p-4 space-y-1`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>{pk.highlightsHeading}</h2>
          <ul className="list-disc list-inside space-y-0.5">
            {trip.highlights.map((h, i) => <li key={i} className={`text-sm ${TEXT_BODY}`}>{h}</li>)}
          </ul>
        </section>
      )}

      {registration ? (
        <RegisteredCard registration={registration} onCancel={handleCancel} cancelling={cancelling} />
      ) : (
        <section className={`${CARD} p-4 space-y-2`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>{tr.joinHeading}</h2>
          <p className={`text-sm ${TEXT_BODY}`}>{tr.joinBody}</p>
          <button type="button" onClick={() => setFormOpen(true)} className={BTN_PRIMARY}>{pk.register}</button>
        </section>
      )}

      {formOpen && (
        <RegisterWizard
          title={trip.title}
          subtitle={dates ?? undefined}
          currency={trip.currency}
          basePrice={trip.price ?? 0}
          baseLabel={tr.baseLabel}
          dateMode="fixed"
          fixedStart={trip.start_date}
          fixedEnd={trip.end_date}
          addonIds={trip.addon_ids}
          roomTypeIds={trip.room_type_ids}
          disclaimer={tr.disclaimer}
          onSubmit={(sel) => registerForScheduledTrip({
            scheduledTripId: trip.id,
            addonIds: sel.addonIds,
            roomId: sel.roomId,
            notes: sel.notes,
          })}
          onClose={() => setFormOpen(false)}
          onRegistered={async (result) => {
            setFormOpen(false)
            await refreshRegistration()
            if (result.already_registered) {
              toast.success(tr.alreadyRegistered)
            } else if (result.emailed) {
              toast.success(tr.registeredEmailed)
            } else {
              toast.success(pk.registeredNoEmail)
            }
          }}
        />
      )}
    </div>
  )
}

function RegisteredCard({ registration, onCancel, cancelling }: {
  registration: MyScheduledTripRegistration
  onCancel: () => void
  cancelling: boolean
}) {
  return (
    <section className={`${CARD} p-4 space-y-2`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>{pk.youreRegistered}</h2>
      {registration.estimated_cost != null && (
        <p className={`text-sm ${TEXT_HEADING}`}>
          {pk.estimatedCost(
            registration.estimated_cost.toLocaleString(),
            registration.estimated_currency ?? siteConfig.locale.currency,
          )}
        </p>
      )}
      <p className={`text-xs ${TEXT_SUBTLE}`}>{tr.finalCostNote(registration.status)}</p>
      <button type="button" onClick={onCancel} disabled={cancelling} className={`${BTN_DANGER} disabled:opacity-50`}>
        {cancelling ? pk.cancelling : pk.cancelRegistration}
      </button>
    </section>
  )
}

function BackLink() {
  return <Link to="/scheduled-trips" className={`text-sm ${ON_DEEP_LINK}`}>{tr.back}</Link>
}
