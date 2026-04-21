import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import type { Booking, Event } from '../types/database'

type BookingWithEvent = Booking & { event: Event | null }

const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-amber-400',
  confirmed: 'text-emerald-400',
  cancelled: 'text-slate-500 line-through',
  waitlisted: 'text-violet-400',
}

export function BookingsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<BookingWithEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { return }
    let cancelled = false
    ;(async () => {
      const { data: bookings } = await supabase
        .from('bookings')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (cancelled) return

      const eventIds = (bookings ?? [])
        .map(b => b.eo_dive_id ?? b.eo_course_id)
        .filter((id): id is string => !!id)

      let eventMap = new Map<string, Event>()
      if (eventIds.length) {
        const { data: events } = await supabase
          .from('events')
          .select('*')
          .in('id', eventIds)
        if (cancelled) return
        eventMap = new Map((events ?? []).map(e => [e.id, e]))
      }

      setRows((bookings ?? []).map(b => ({
        ...b,
        event: eventMap.get((b.eo_dive_id ?? b.eo_course_id)!) ?? null,
      })))
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [user])

  const upcoming = rows.filter(r =>
    r.status !== 'cancelled' && r.event && new Date(r.event.start_time) >= new Date()
  )
  const past = rows.filter(r =>
    r.status === 'cancelled' || !r.event || new Date(r.event.start_time) < new Date()
  )

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  function BookingCard({ row }: { row: BookingWithEvent }) {
    return (
      <div className="bg-slate-800 rounded-xl p-4 space-y-1">
        <div className="flex items-start justify-between">
          <span className="font-medium text-slate-100 text-sm">
            {row.event?.title ?? '(event unavailable)'}
          </span>
          <span className={`text-xs font-medium capitalize ${STATUS_STYLES[row.status]}`}>{row.status}</span>
        </div>
        {row.event && (
          <p className="text-xs text-slate-400">
            {format(new Date(row.event.start_time), 'EEE, MMM d yyyy · HH:mm')}
            {' · '}
            {row.event.type === 'dive' ? 'Dive' : 'Course'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">My Bookings</h1>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Upcoming</h2>
        {upcoming.length === 0
          ? <p className="text-slate-500 text-sm">No upcoming bookings. Check the calendar!</p>
          : <div className="space-y-2">{upcoming.map(r => <BookingCard key={r.id} row={r} />)}</div>
        }
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Past / Cancelled</h2>
          <div className="space-y-2">{past.map(r => <BookingCard key={r.id} row={r} />)}</div>
        </section>
      )}
    </div>
  )
}
