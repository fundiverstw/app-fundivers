import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { fetchEventsInRange } from '../../lib/events'
import type { AppEvent } from '../../types/database'

export function AdminEventsPage() {
  const [month, setMonth] = useState(new Date())
  const [events, setEvents] = useState<AppEvent[]>([])

  useEffect(() => {
    const from = startOfMonth(month).toISOString().slice(0, 10)
    const to = endOfMonth(month).toISOString().slice(0, 10)
    fetchEventsInRange(from, to).then(setEvents)
  }, [month])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">‹</button>
        <h1 className="text-lg font-bold text-slate-100">Events — {format(month, 'MMMM yyyy')}</h1>
        <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">›</button>
      </div>

      {events.length === 0 && (
        <p className="text-slate-500 text-sm">No events this month.</p>
      )}

      <div className="space-y-2">
        {events.map(ev => (
          <Link
            key={`${ev.type}_${ev.id}`}
            to={`/admin/events/${ev.type}/${ev.id}`}
            className="block bg-slate-800 rounded-xl p-3 hover:bg-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${ev.type === 'dive' ? 'bg-sky-500' : 'bg-emerald-500'}`}>
                    {ev.type === 'dive' ? 'Dive' : 'Course'}
                  </span>
                  <span className="font-medium text-slate-100 text-sm">{ev.title}</span>
                  {ev.featured && <span className="text-xs text-amber-400">★</span>}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {format(new Date(ev.start_time), 'EEE, MMM d · HH:mm')}
                  {ev.end_time && ` → ${format(new Date(ev.end_time), 'MMM d')}`}
                </p>
              </div>
              {ev.fully_booked && (
                <span className="text-xs text-rose-400 font-medium shrink-0">Fully booked</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
