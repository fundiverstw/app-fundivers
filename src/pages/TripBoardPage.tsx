import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchTripBoard, fetchMyTripReferrals } from '../lib/trip-board'
import { tripDateLabel } from '../lib/trip-format'
import { errorMessage } from '../lib/errors'
import type { TripBoardItem, MyTripReferral } from '../types/database'
import {
  CARD, PAGE_HEADING, PAGE_BODY, ON_DEEP_LINK, TEXT_HEADING, TEXT_SUBTLE,
} from '../styles/tokens'

// Trip Board (diver-facing) — the curated trips abroad we vouch for. Booking
// happens at the partner shop; expressing interest here mints a referral code
// and we broker the intro. Complements Partner Connect (the pull side: a diver
// names a destination and we suggest a shop).
export function TripBoardPage() {
  const [trips, setTrips] = useState<TripBoardItem[]>([])
  const [referrals, setReferrals] = useState<MyTripReferral[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [t, r] = await Promise.all([fetchTripBoard(), fetchMyTripReferrals()])
        if (cancelled) return
        setTrips(t)
        setReferrals(r)
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const referralByTrip = new Map(referrals.map(r => [r.trip_id, r]))

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>Trip Board</h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          Dive trips abroad we've personally vetted. Tap one you like — we'll
          give you a reference code and connect you with the shop directly.
        </p>
        <p className="text-sm">
          <Link to="/partner-connect" className={ON_DEEP_LINK}>
            Headed somewhere not listed? Try Partner Connect →
          </Link>
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      )}

      {loading ? (
        <p className={`text-sm ${PAGE_BODY}`}>Loading…</p>
      ) : trips.length === 0 ? (
        <p className={`text-sm ${PAGE_BODY}`}>No trips on the board right now — check back soon.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {trips.map(trip => (
            <li key={trip.id}>
              <TripCard trip={trip} referral={referralByTrip.get(trip.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TripCard({ trip, referral }: { trip: TripBoardItem; referral: MyTripReferral | null }) {
  const dates = tripDateLabel(trip.start_date, trip.end_date)
  return (
    <Link to={`/trips/${trip.id}`} className={`${CARD} block overflow-hidden hover:bg-white/90 transition-colors h-full`}>
      {trip.hero_image_url ? (
        <img src={trip.hero_image_url} alt="" className="w-full h-36 object-cover" />
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-surface-200 to-brand-300" />
      )}
      <div className="p-3 space-y-1">
        <p className={`text-sm ${TEXT_HEADING} truncate`}>{trip.title}</p>
        <p className={`text-xs ${TEXT_SUBTLE} truncate`}>{trip.destination}</p>
        {dates && <p className={`text-xs ${TEXT_SUBTLE}`}>{dates}</p>}
        <div className="flex items-center justify-between pt-1 gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-400 bg-emerald-50 text-emerald-800 font-medium truncate">
            Vouched by {trip.partner_name}
          </span>
          {trip.price != null && (
            <span className={`text-xs ${TEXT_HEADING} shrink-0`}>{trip.price.toLocaleString()} {trip.currency}</span>
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
