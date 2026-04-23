import { useEffect, useState } from 'react'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsInRange } from '../lib/events'
import { MonthCalendar } from '../components/calendar/MonthCalendar'
import { RegisterForm } from '../components/register/RegisterForm'
import type { AppEvent, Booking } from '../types/database'

const TYPE_DOT: Record<AppEvent['type'], string> = {
  dive:   'bg-sky-500',
  course: 'bg-emerald-500',
}
const TYPE_LABELS: Record<AppEvent['type'], string> = {
  dive:   'Dive',
  course: 'Course',
}

function fkFor(ev: AppEvent) {
  return ev.type === 'dive'
    ? { col: 'eo_dive_id' as const }
    : { col: 'eo_course_id' as const }
}

function bookingMatches(b: Booking, ev: AppEvent) {
  return ev.type === 'dive' ? b.eo_dive_id === ev.id : b.eo_course_id === ev.id
}

export function CalendarPage() {
  const { user, profile } = useAuth()
  const [month, setMonth] = useState(new Date())
  const [events, setEvents] = useState<AppEvent[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selected, setSelected] = useState<AppEvent | null>(null)
  const [registering, setRegistering] = useState<AppEvent | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)

  useEffect(() => {
    // Widen fetch ±7 days so bars crossing into the visible month render continuously.
    const fromDate = new Date(startOfMonth(month).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
    const toDate = new Date(endOfMonth(month).getTime() + 7 * 86_400_000).toISOString().slice(0, 10)
    fetchEventsInRange(fromDate, toDate).then(setEvents)
  }, [month])

  useEffect(() => {
    if (!user) return
    supabase
      .from('bookings')
      .select('*')
      .eq('user_id', user.id)
      .then(({ data }) => setBookings(data ?? []))
  }, [user])

  function isBooked(ev: AppEvent) {
    return bookings.some(b => bookingMatches(b, ev) && b.status !== 'cancelled')
  }

  async function cancelBooking() {
    if (!user || !selected) return
    setBookingLoading(true)
    const { col } = fkFor(selected)
    await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('user_id', user.id)
      .eq(col, selected.id)
    setBookings(prev => prev.map(b =>
      bookingMatches(b, selected) ? { ...b, status: 'cancelled' } : b
    ))
    setBookingLoading(false)
  }

  function startRegister() {
    if (!selected) return
    setRegistering(selected)
    setSelected(null)
  }

  function handleBooked(booking: unknown) {
    setBookings(prev => [...prev, booking as Booking])
    setRegistering(null)
  }

  return (
    <div className="max-w-lg mx-auto">
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        events={events}
        onPickEvent={setSelected}
        renderListBadge={ev => isBooked(ev)
          ? <span className="text-xs text-emerald-400 font-medium">Booked</span>
          : null
        }
      />

      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-slate-800 rounded-t-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full text-white ${TYPE_DOT[selected.type]}`}>
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
              onClick={isBooked(selected) ? cancelBooking : startRegister}
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

      {registering && user && (
        <RegisterForm
          event={registering}
          profile={profile}
          userId={user.id}
          onClose={() => setRegistering(null)}
          onBooked={handleBooked}
        />
      )}
    </div>
  )
}
