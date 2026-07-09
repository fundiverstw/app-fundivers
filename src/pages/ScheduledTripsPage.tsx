import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchScheduledTrips, fetchMyScheduledTripRegistrations } from '../lib/scheduled-trips'
import { packageDateLabel } from '../lib/package-format'
import { errorMessage } from '../lib/errors'
import { siteConfig } from '../config/site'
import type { ScheduledTripItem, MyScheduledTripRegistration } from '../types/database'
import {
  CARD, PAGE_HEADING, PAGE_BODY, ON_DEEP_LINK, TEXT_HEADING, TEXT_SUBTLE,
} from '../styles/tokens'
import { t } from '../i18n'

const tr = t.trips
const pk = t.packages

// Scheduled Trips (diver-facing) — the shop's own curated, dated trips (boat
// trips, liveaboards, away weekends). Reads list_scheduled_trips(); tapping a
// trip opens its detail page where the diver registers (picks add-ons/room, sees
// an estimate). Distinct from Packages, which are partner-shop travel packages.
export function ScheduledTripsPage() {
  const [trips, setTrips] = useState<ScheduledTripItem[] | null>(null)
  const [registrations, setRegistrations] = useState<MyScheduledTripRegistration[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [list, regs] = await Promise.all([fetchScheduledTrips(), fetchMyScheduledTripRegistrations()])
        if (cancelled) return
        setTrips(list)
        setRegistrations(regs)
      } catch (err) {
        if (!cancelled) { setError(errorMessage(err)); setTrips([]) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // A diver has one live registration per trip at most (the one-live index).
  const liveByTrip = new Map(
    registrations.filter(r => r.status !== 'cancelled').map(r => [r.scheduled_trip_id, r]),
  )

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="space-y-1">
        <h1 className={`text-xl ${PAGE_HEADING} font-bold`}>{tr.title}</h1>
        <p className={`text-sm ${PAGE_BODY}`}>{tr.intro}</p>
        <p className="text-sm">
          <Link to="/packages" className={ON_DEEP_LINK}>
            {tr.packagesLink}
          </Link>
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{error}</p>
      )}

      {trips === null ? (
        <p className={`text-sm ${PAGE_BODY}`}>{pk.loading}</p>
      ) : trips.length === 0 ? (
        <p className={`text-sm ${PAGE_BODY}`}>{tr.none}</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {trips.map(trip => (
            <li key={trip.id}><TripCard trip={trip} registration={liveByTrip.get(trip.id) ?? null} /></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TripCard({ trip, registration }: { trip: ScheduledTripItem; registration: MyScheduledTripRegistration | null }) {
  const dates = packageDateLabel(trip.start_date, trip.end_date)
  return (
    <Link to={`/scheduled-trips/${trip.id}`} className={`${CARD} block overflow-hidden hover:bg-white/90 transition-colors h-full`}>
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
          <span className={`text-xs ${TEXT_SUBTLE}`}>{tr.tapToRegister}</span>
          {trip.price != null && (
            <span className={`text-xs ${TEXT_HEADING} shrink-0`}>{pk.fromPrice(trip.price.toLocaleString(), trip.currency)}</span>
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
