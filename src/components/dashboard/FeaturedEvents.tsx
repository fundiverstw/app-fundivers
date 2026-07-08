import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { fetchEventsInRange, formatEventSpan, isPastEvent, eventIsFull } from '../../lib/events'
import { resolveImageUrl } from '../../lib/images'
import type { AppEvent } from '../../types/database'

// Highlights upcoming events the admin has flagged `featured`, floated over the
// dashboard's animated caustics as a stack of image-led hero cards. Each card
// shows the event's featured photo (resolveImageUrl → self-hosted copy) under a
// dark gradient so the title stays legible, and deep-links straight into that
// event's registration form (/register/:type/:id). Renders nothing when there's
// no featured event coming up, so the ambient background stays clear.

const LOOKAHEAD_DAYS = 120
const MAX_SHOWN = 3

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
    <div className="absolute inset-x-4 bottom-24 sm:inset-x-auto sm:left-6 sm:bottom-6 sm:w-[24rem] z-10">
      <section aria-label="Featured trips" className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-reef-300 flex items-center gap-2 drop-shadow">
          <span aria-hidden>★</span> Featured trips
        </h2>
        <ul className="space-y-3">
          {events.map(e => (
            <li key={`${e.type}-${e.id}`}>
              <FeaturedCard event={e} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function FeaturedCard({ event: e }: { event: AppEvent }) {
  const img = resolveImageUrl(e.featured_image)
  const full = eventIsFull(e)

  return (
    <Link
      to={`/register/${e.type}/${e.id}`}
      className="group glass glow-teal relative block h-32 overflow-hidden rounded-2xl shadow-lg"
    >
      {img ? (
        <img
          src={img}
          alt=""
          aria-hidden="true"
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        // No photo → a reef→mauve wash so the card still reads as a hero.
        <div className="absolute inset-0 bg-gradient-to-br from-reef-500/40 via-brand-800/40 to-mauve/30" />
      )}

      {/* Legibility scrim — dark at the bottom where the text sits. */}
      <div className="absolute inset-0 bg-gradient-to-t from-brand-950/95 via-brand-950/45 to-brand-950/10" />

      <div className="absolute inset-x-0 bottom-0 p-3.5">
        <p className="text-base font-bold leading-tight text-white drop-shadow-sm">{e.title}</p>
        <p className="mono mt-1 text-xs font-medium text-brand-100/90">
          {formatEventSpan(e, { withYear: true })}
          {full && <span className="text-red-300 font-semibold"> · waitlist</span>}
        </p>
      </div>

      <span className="absolute right-3 top-3 rounded-full bg-brand-950/50 px-2.5 py-1 text-[11px] font-semibold text-reef-200 backdrop-blur-sm transition-colors group-hover:text-reef-100">
        Register →
      </span>
    </Link>
  )
}
