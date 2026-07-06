import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { fetchScheduledTrips } from '../lib/scheduled-trips'
import { errorMessage } from '../lib/errors'
import type { ScheduledTripItem } from '../types/database'
import {
  CARD, PAGE_HEADING, PAGE_BODY, ON_DEEP_LINK, TEXT_HEADING, TEXT_SUBTLE,
} from '../styles/tokens'

/** Human date span for a trip card: a single day, or "d MMM – d MMM yyyy".
 *  Null when no start date is set. */
function dateSpan(start: string | null, end: string | null): string | null {
  if (!start) return null
  const s = format(parseISO(start), 'd MMM yyyy')
  if (!end || end === start) return s
  return `${format(parseISO(start), 'd MMM')} – ${format(parseISO(end), 'd MMM yyyy')}`
}

// Scheduled Trips (diver-facing) — the shop's own curated, dated trips (boat
// trips, liveaboards, away weekends). Reads the admin-managed scheduled_trips
// table via list_scheduled_trips(); a trip linked to a catalog event drops the
// diver straight into registration, otherwise it points them at Contact.
// Distinct from Packages, which are open-ended travel packages abroad booked at
// a partner shop.
export function ScheduledTripsPage() {
  const [trips, setTrips] = useState<ScheduledTripItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchScheduledTrips()
        if (!cancelled) setTrips(list)
      } catch (err) {
        if (!cancelled) { setError(errorMessage(err)); setTrips([]) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>Scheduled Trips</h1>
        <p className={`text-sm ${PAGE_BODY}`}>
          Our upcoming shop trips. Tap one to register.
        </p>
        <p className="text-sm">
          <Link to="/packages" className={ON_DEEP_LINK}>
            After an open-ended travel package instead? See Packages →
          </Link>
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      )}

      {trips === null ? (
        <p className={`text-sm ${PAGE_BODY}`}>Loading…</p>
      ) : trips.length === 0 ? (
        <p className={`text-sm ${PAGE_BODY}`}>No trips scheduled right now — check back soon.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {trips.map(trip => (
            <li key={trip.id}><TripCard trip={trip} /></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TripCard({ trip }: { trip: ScheduledTripItem }) {
  // A trip linked to a bookable event routes to registration; otherwise it's an
  // informational card that points the diver at Contact to enquire.
  const to = trip.event_id && trip.event_kind
    ? `/register/${trip.event_kind}/${trip.event_id}`
    : '/contact'
  const dates = dateSpan(trip.start_date, trip.end_date)
  return (
    <Link to={to} className={`${CARD} block overflow-hidden hover:bg-white/90 transition-colors h-full`}>
      {trip.hero_image_url ? (
        <img src={trip.hero_image_url} alt="" className="w-full h-36 object-cover" />
      ) : (
        <div className="w-full h-36 bg-gradient-to-br from-surface-200 to-brand-300" />
      )}
      <div className="p-3 space-y-1">
        <p className={`text-sm ${TEXT_HEADING} break-words`}>{trip.title}</p>
        <p className={`text-xs ${TEXT_SUBTLE} truncate`}>{trip.destination}</p>
        {dates && <p className={`text-xs ${TEXT_SUBTLE}`}>{dates}</p>}
        <div className="flex items-center justify-between pt-1 gap-2">
          <span className={`text-xs ${TEXT_SUBTLE}`}>
            {trip.event_id ? 'Tap to register' : 'Contact us to join'}
          </span>
          {trip.price != null && (
            <span className={`text-xs ${TEXT_HEADING} shrink-0`}>{trip.price.toLocaleString()} {trip.currency}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
