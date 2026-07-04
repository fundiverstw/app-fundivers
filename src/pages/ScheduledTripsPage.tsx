import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchEventsInRange, formatEventSpan } from '../lib/events'
import { dayKeyOffset } from '../lib/logistics'
import { siteConfig } from '../config/site'
import { errorMessage } from '../lib/errors'
import type { AppEvent } from '../types/database'
import {
  CARD, PAGE_HEADING, PAGE_BODY, ON_DEEP_LINK, TEXT_HEADING, TEXT_SUBTLE,
} from '../styles/tokens'

// How far ahead we surface scheduled trips.
const LOOKAHEAD_DAYS = 180

// Scheduled Trips (diver-facing) — the shop's upcoming trips, i.e. the
// scheduled dive/course events the calendar flags as trips (via the configured
// trip keywords). Tapping one drops the diver into that event's registration.
// Distinct from Packages, which are open-ended travel packages abroad with no
// fixed date.
export function ScheduledTripsPage() {
  const [trips, setTrips] = useState<AppEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const today = new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone })
    ;(async () => {
      try {
        const events = await fetchEventsInRange(today, dayKeyOffset(today, LOOKAHEAD_DAYS))
        if (cancelled) return
        // Only events explicitly flagged as trips — a boat dive is not a trip.
        // A course can yield several segments; keep the first per event id.
        const seen = new Set<string>()
        const list = events
          .filter(e => e.is_trip)
          .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
        setTrips(list)
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
          <Link to="/trips" className={ON_DEEP_LINK}>
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
          {trips.map(ev => (
            <li key={ev.id}>
              <Link
                to={`/register/${ev.type}/${ev.id}`}
                className={`${CARD} block p-3 space-y-1 hover:bg-white/90 transition-colors h-full`}
              >
                <p className={`text-sm ${TEXT_HEADING} break-words`}>{ev.title}</p>
                <p className={`text-xs ${TEXT_SUBTLE}`}>{formatEventSpan(ev, { withYear: true })}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
