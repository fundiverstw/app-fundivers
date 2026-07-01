import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchTripBoardItem, fetchMyTripReferrals, expressTripInterest } from '../lib/trip-board'
import { errorMessage } from '../lib/errors'
import { useToast } from '../hooks/useToast'
import { tripDateLabel } from '../lib/trip-format'
import type { TripBoardItem, MyTripReferral } from '../types/database'
import {
  CARD, BTN_PRIMARY, PAGE_BODY, TEXT_LINK, ON_DEEP_LINK, TEXT_HEADING, TEXT_BODY, TEXT_SUBTLE,
} from '../styles/tokens'

// Trip detail — full pitch for one curated trip, plus the "I'm interested"
// action that mints the diver's referral code. We broker the intro, so the
// code is the thread that ties the diver's eventual booking at the partner
// shop back to us for the kickback.
export function TripDetailPage() {
  const { id } = useParams<{ id: string }>()
  const toast = useToast()
  const [trip, setTrip] = useState<TripBoardItem | null>(null)
  const [referral, setReferral] = useState<MyTripReferral | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const [t, refs] = await Promise.all([fetchTripBoardItem(id), fetchMyTripReferrals()])
        if (cancelled) return
        setTrip(t)
        setReferral(refs.find(r => r.trip_id === id) ?? null)
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
      const code = await expressTripInterest(id)
      // Reflect the new (or existing) referral without a full refetch.
      const refs = await fetchMyTripReferrals()
      setReferral(refs.find(r => r.trip_id === id) ?? { id: '', trip_id: id, referral_code: code, status: 'interested', created_at: '', trip_title: trip?.title ?? '', trip_destination: trip?.destination ?? '', partner_name: trip?.partner_name ?? '' })
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
  if (!trip) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <BackLink />
        <p className={`text-sm ${PAGE_BODY}`}>This trip isn’t on the board anymore.</p>
      </div>
    )
  }

  const dates = tripDateLabel(trip.start_date, trip.end_date)

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
          <p className={`text-sm ${TEXT_SUBTLE}`}>
            {trip.destination}{dates ? ` · ${dates}` : ''}
          </p>
          <span className="inline-block text-xs px-2 py-0.5 rounded-full border border-emerald-400 bg-emerald-50 text-emerald-800 font-medium">
            Vouched by {trip.partner_name}
          </span>
          {trip.price != null && (
            <p className={`text-sm ${TEXT_HEADING}`}>{trip.price.toLocaleString()} {trip.currency}</p>
          )}
          {trip.summary && <p className={`text-sm ${TEXT_BODY}`}>{trip.summary}</p>}
        </div>
      </div>

      {trip.description && (
        <section className={`${CARD} p-4 space-y-1`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>About this trip</h2>
          <p className={`text-sm ${TEXT_BODY} whitespace-pre-wrap`}>{trip.description}</p>
        </section>
      )}

      {trip.highlights.length > 0 && (
        <section className={`${CARD} p-4 space-y-1`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>Highlights</h2>
          <ul className="list-disc list-inside space-y-0.5">
            {trip.highlights.map((h, i) => <li key={i} className={`text-sm ${TEXT_BODY}`}>{h}</li>)}
          </ul>
        </section>
      )}

      <section className={`${CARD} p-4 space-y-1`}>
        <h2 className={`text-sm ${TEXT_HEADING}`}>The shop we vouch for</h2>
        <p className={`text-sm ${TEXT_BODY}`}>
          {trip.partner_name} · {[trip.partner_location, trip.partner_country].filter(Boolean).join(', ')}
        </p>
        {trip.partner_vouch_notes && <p className={`text-sm ${TEXT_SUBTLE}`}>{trip.partner_vouch_notes}</p>}
        {trip.partner_website && (
          <a href={trip.partner_website} target="_blank" rel="noopener noreferrer" className={`text-sm ${TEXT_LINK}`}>
            Visit their site →
          </a>
        )}
      </section>

      {referral ? (
        <InterestedCard trip={trip} referral={referral} />
      ) : (
        <section className={`${CARD} p-4 space-y-2`}>
          <h2 className={`text-sm ${TEXT_HEADING}`}>Interested?</h2>
          <p className={`text-sm ${TEXT_BODY}`}>
            Tap below and we’ll give you a reference code, then personally
            connect you with {trip.partner_name}. No payment here — you book
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

function InterestedCard({ trip, referral }: { trip: TripBoardItem; referral: MyTripReferral }) {
  return (
    <section className={`${CARD} p-4 space-y-2`}>
      <h2 className={`text-sm ${TEXT_HEADING}`}>You’re on the list</h2>
      <p className={`text-sm ${TEXT_BODY}`}>
        We’ll be in touch to connect you with {trip.partner_name}. When you
        book, mention this reference code so we’re credited:
      </p>
      <p className="text-lg font-bold tracking-wider text-brand-900 bg-surface-50 border border-surface-300 rounded-lg px-3 py-2 text-center">
        {referral.referral_code}
      </p>
      <p className={`text-xs ${TEXT_SUBTLE}`}>Status: {referral.status}</p>
      {trip.booking_url && (
        <a href={trip.booking_url} target="_blank" rel="noopener noreferrer" className={`${BTN_PRIMARY} inline-block text-center`}>
          Book on the partner’s site →
        </a>
      )}
    </section>
  )
}

function BackLink() {
  return <Link to="/trips" className={`text-sm ${ON_DEEP_LINK}`}>← Trip Board</Link>
}
