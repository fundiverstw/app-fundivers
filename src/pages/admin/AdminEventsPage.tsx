import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { startOfMonth, endOfMonth } from 'date-fns'
import { fetchEventsInRange } from '../../lib/events'
import { supabase } from '../../lib/supabase'
import { MonthCalendar } from '../../components/calendar/MonthCalendar'
import type { AppEvent } from '../../types/database'

export function AdminEventsPage() {
  const navigate = useNavigate()
  const [month, setMonth] = useState(new Date())
  const [events, setEvents] = useState<AppEvent[]>([])
  const [counts, setCounts] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    // Widen ±7 days so bars touching the month from either side render
    // continuously — same pattern as the diver calendar.
    const from = new Date(startOfMonth(month).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
    const to = new Date(endOfMonth(month).getTime() + 7 * 86_400_000).toISOString().slice(0, 10)

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
    <div className="max-w-2xl mx-auto">
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        events={events}
        onPickEvent={ev => navigate(`/admin/events/${ev.type}/${ev.id}`)}
        hidePastInList
        renderListBadge={ev => {
          const regs = counts.get(ev.id) ?? 0
          if (regs === 0) return null
          return (
            <span className="inline-block text-xs px-2 py-0.5 rounded-full bg-amber-900 text-amber-200">
              {regs} registered
            </span>
          )
        }}
      />
    </div>
  )
}
