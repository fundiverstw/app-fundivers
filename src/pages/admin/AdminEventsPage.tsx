import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns'
import { fetchEventsInRange } from '../../lib/events'
import { supabase } from '../../lib/supabase'
import type { AppEvent } from '../../types/database'

export function AdminEventsPage() {
  const [month, setMonth] = useState(new Date())
  const [events, setEvents] = useState<AppEvent[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    const from = startOfMonth(month).toISOString().slice(0, 10)
    const to = endOfMonth(month).toISOString().slice(0, 10)

    let cancelled = false
    ;(async () => {
      const evs = await fetchEventsInRange(from, to)
      if (cancelled) return
      setEvents(evs)

      const diveIds = evs.filter(e => e.type === 'dive').map(e => e.id)
      const courseIds = evs.filter(e => e.type === 'course').map(e => e.id)
      if (diveIds.length === 0 && courseIds.length === 0) { setCounts(new Map()); return }

      const [divesRes, coursesRes] = await Promise.all([
        diveIds.length
          ? supabase.from('bookings').select('eo_dive_id').in('eo_dive_id', diveIds).neq('status', 'cancelled')
          : Promise.resolve({ data: [] }),
        courseIds.length
          ? supabase.from('bookings').select('eo_course_id').in('eo_course_id', courseIds).neq('status', 'cancelled')
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return

      const next = new Map<string, number>()
      for (const r of (divesRes.data ?? []) as Array<{ eo_dive_id: string | null }>) {
        if (r.eo_dive_id) next.set(r.eo_dive_id, (next.get(r.eo_dive_id) ?? 0) + 1)
      }
      for (const r of (coursesRes.data ?? []) as Array<{ eo_course_id: string | null }>) {
        if (r.eo_course_id) next.set(r.eo_course_id, (next.get(r.eo_course_id) ?? 0) + 1)
      }
      setCounts(next)
    })()

    return () => { cancelled = true }
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
        {events.map(ev => {
          const regs = counts.get(ev.id) ?? 0
          return (
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
                <div className="text-right shrink-0 space-y-0.5">
                  {regs > 0 && (
                    <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-200">
                      {regs} registered
                    </span>
                  )}
                  {ev.fully_booked && (
                    <p className="text-xs text-rose-400 font-medium">Fully booked</p>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
