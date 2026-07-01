import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { fetchEventsInRange, formatEventSpan, isPastEvent, eventIsFull } from '../../lib/events'
import type { AppEvent } from '../../types/database'

// Highlights upcoming events the admin has flagged `featured`, floated over the
// dashboard's bubbles. Each card deep-links straight into that event's
// registration form (/register/:type/:id). Renders nothing when there's no
// featured event coming up, so the easter-egg playground stays clear.

const LOOKAHEAD_DAYS = 120
const MAX_SHOWN = 4

export function FeaturedEvents() {
  const [events, setEvents] = useState<AppEvent[]>([])

  useEffect(() => {
    let cancelled = false
    const today = new Date()
    const from = format(today, 'yyyy-MM-dd')
    const to = format(new Date(today.getTime() + LOOKAHEAD_DAYS * 86_400_000), 'yyyy-MM-dd')
    fetchEventsInRange(from, to)
      .then(all => {
        if (cancelled) return
        setEvents(all.filter(e => e.featured && !isPastEvent(e)).slice(0, MAX_SHOWN))
      })
      .catch(() => { /* a fetch failure just leaves the playground empty */ })
    return () => { cancelled = true }
  }, [])

  if (events.length === 0) return null

  return (
    <div className="absolute bottom-28 left-4 right-4 sm:right-auto sm:max-w-xs z-10">
      <section
        aria-label="Featured trips"
        className="bg-white/85 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2 shadow-lg"
      >
        <h2 className="text-xs font-bold uppercase tracking-wider text-brand-900 flex items-center gap-1.5">
          <span aria-hidden>★</span> Featured trips
        </h2>
        <ul className="space-y-1.5">
          {events.map(e => {
            const full = eventIsFull(e)
            return (
              <li key={`${e.type}-${e.id}`}>
                <Link
                  to={`/register/${e.type}/${e.id}`}
                  className="block rounded-lg bg-surface-50 hover:bg-surface-100 border border-surface-200 px-3 py-2 transition-colors"
                >
                  <p className="text-sm font-semibold text-brand-900 leading-tight">{e.title}</p>
                  <p className="text-xs text-brand-900/70 mt-0.5">
                    {formatEventSpan(e, { withYear: true })}
                    {full && <span className="text-red-600 font-medium"> · waitlist</span>}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
