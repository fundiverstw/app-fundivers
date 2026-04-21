import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth, addMonths, subMonths } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsInRange } from '../lib/events'
import type { AppEvent, Booking } from '../types/database'

const TYPE_COLORS: Record<AppEvent['type'], string> = {
  dive: 'bg-sky-500',
  course: 'bg-emerald-500',
}

const TYPE_LABELS: Record<AppEvent['type'], string> = {
  dive: 'Dive',
  course: 'Course',
}

function fkFor(ev: AppEvent) {
  return ev.type === 'dive'
    ? { col: 'eo_dive_id' as const, payload: { eo_dive_id: ev.id, eo_course_id: null } }
    : { col: 'eo_course_id' as const, payload: { eo_dive_id: null, eo_course_id: ev.id } }
}

function bookingMatches(b: Booking, ev: AppEvent) {
  return ev.type === 'dive' ? b.eo_dive_id === ev.id : b.eo_course_id === ev.id
}

export function CalendarPage() {
  const { user } = useAuth()
  const [month, setMonth] = useState(new Date())
  const [events, setEvents] = useState<AppEvent[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selected, setSelected] = useState<AppEvent | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })

  useEffect(() => {
    const from = startOfMonth(month).toISOString().slice(0, 10)
    const to = endOfMonth(month).toISOString().slice(0, 10)
    fetchEventsInRange(from, to).then(setEvents)
  }, [month])

  useEffect(() => {
    if (!user) return
    supabase
      .from('bookings')
      .select('*')
      .eq('user_id', user.id)
      .then(({ data }) => setBookings(data ?? []))
  }, [user])

  function eventsOnDay(day: Date) {
    return events.filter(e => isSameDay(new Date(e.start_time), day))
  }

  function isBooked(ev: AppEvent) {
    return bookings.some(b => bookingMatches(b, ev) && b.status !== 'cancelled')
  }

  async function handleBook() {
    if (!user || !selected) return
    setBookingLoading(true)
    const { col, payload } = fkFor(selected)

    if (isBooked(selected)) {
      await supabase
        .from('bookings')
        .update({ status: 'cancelled' })
        .eq('user_id', user.id)
        .eq(col, selected.id)
      setBookings(prev => prev.map(b =>
        bookingMatches(b, selected) ? { ...b, status: 'cancelled' } : b
      ))
    } else {
      const { data } = await supabase
        .from('bookings')
        .insert({ user_id: user.id, status: 'pending', ...payload })
        .select()
        .single()
      if (data) setBookings(prev => [...prev, data])
    }
    setBookingLoading(false)
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">‹</button>
        <h1 className="text-lg font-bold text-slate-100">{format(month, 'MMMM yyyy')}</h1>
        <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">›</button>
      </div>

      <div className="flex gap-3 text-xs text-slate-400">
        {(Object.keys(TYPE_COLORS) as AppEvent['type'][]).map(t => (
          <span key={t} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${TYPE_COLORS[t]}`} />{TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-slate-700 rounded-xl overflow-hidden text-sm">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="bg-slate-800 text-center text-xs text-slate-500 py-1">{d}</div>
        ))}
        {Array.from({ length: days[0].getDay() }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-slate-800 h-14" />
        ))}
        {days.map(day => {
          const dayEvents = eventsOnDay(day)
          const isToday = isSameDay(day, new Date())
          const inMonth = isSameMonth(day, month)
          return (
            <div
              key={day.toISOString()}
              className={`bg-slate-800 h-14 p-1 cursor-pointer hover:bg-slate-700 transition-colors ${!inMonth ? 'opacity-30' : ''}`}
              onClick={() => dayEvents.length > 0 && setSelected(dayEvents[0])}
            >
              <span className={`text-xs block text-center rounded-full w-5 h-5 flex items-center justify-center mx-auto ${
                isToday ? 'bg-sky-500 text-white font-bold' : 'text-slate-300'
              }`}>
                {format(day, 'd')}
              </span>
              <div className="flex flex-wrap gap-0.5 mt-0.5 justify-center">
                {dayEvents.map(e => (
                  <span key={e.id} className={`w-1.5 h-1.5 rounded-full ${TYPE_COLORS[e.type]}`} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">This month</h2>
        {events.length === 0 && (
          <p className="text-slate-500 text-sm">No events scheduled.</p>
        )}
        {events.map(ev => (
          <button
            key={ev.id}
            onClick={() => setSelected(ev)}
            className="w-full text-left bg-slate-800 rounded-xl p-3 hover:bg-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${TYPE_COLORS[ev.type]}`}>
                    {TYPE_LABELS[ev.type]}
                  </span>
                  <span className="font-medium text-slate-100 text-sm">{ev.title}</span>
                  {ev.featured && <span className="text-xs text-amber-400">★</span>}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {format(new Date(ev.start_time), 'EEE, MMM d · HH:mm')}
                </p>
              </div>
              {isBooked(ev) && (
                <span className="text-xs text-emerald-400 font-medium shrink-0">Booked</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-slate-800 rounded-t-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full text-white ${TYPE_COLORS[selected.type]}`}>
                {TYPE_LABELS[selected.type]}
              </span>
              <button onClick={() => setSelected(null)} className="text-slate-400 text-xl leading-none">×</button>
            </div>
            <h2 className="text-xl font-bold text-slate-100">{selected.title}</h2>
            <div className="text-sm text-slate-400 space-y-1">
              <p>{format(new Date(selected.start_time), 'EEEE, MMMM d · HH:mm')}</p>
              {selected.end_time && (
                <p>Ends {format(new Date(selected.end_time), 'EEEE, MMMM d')}</p>
              )}
              {selected.price != null && (
                <p>💰 From {selected.currency} {selected.price.toLocaleString()}</p>
              )}
              {selected.fully_booked && <p className="text-rose-400">Fully booked</p>}
            </div>
            <button
              onClick={handleBook}
              disabled={bookingLoading || (!isBooked(selected) && selected.fully_booked)}
              className={`w-full py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                isBooked(selected)
                  ? 'bg-slate-600 hover:bg-red-900 text-slate-200'
                  : 'bg-sky-500 hover:bg-sky-600 text-white'
              }`}
            >
              {bookingLoading ? '…' : isBooked(selected) ? 'Cancel booking' : 'Register'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
