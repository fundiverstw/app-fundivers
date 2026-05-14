import { useEffect, useState } from 'react'
import { startOfMonth, endOfMonth } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsInRange, formatEventSpan, eventIsFull, eventSpotsRemaining } from '../lib/events'
import { MonthCalendar } from '../components/calendar/MonthCalendar'
import { RegisterForm } from '../components/register/RegisterForm'
import type { AppEvent, Booking } from '../types/database'

const TYPE_DOT: Record<AppEvent['type'], string> = {
  dive:   'bg-emerald-600',
  course: 'bg-sky-500',
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
          ? <span className="text-xs text-red-600 font-semibold">Booked</span>
          : null
        }
      />

      {selected && (
        <div className="fixed inset-0 bg-blue-900/60 backdrop-blur-sm flex items-start justify-center z-50 px-4 pt-8 pb-4 overflow-y-auto" onClick={() => setSelected(null)}>
          <div className="bg-white/75 backdrop-blur-md border border-red-500 rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full text-white ${TYPE_DOT[selected.type]}`}>
                {TYPE_LABELS[selected.type]}
              </span>
              <button onClick={() => setSelected(null)} className="text-blue-900 font-medium hover:text-blue-900 text-xl leading-none">×</button>
            </div>
            <h2 className="text-xl font-bold text-blue-900">{selected.title}</h2>
            <div className="text-sm text-blue-900 font-medium space-y-1">
              <p>{formatEventSpan(selected, { style: 'long' })}</p>
              {selected.price != null && (
                <p>💰 From {selected.currency} {selected.price.toLocaleString()}</p>
              )}
              {(() => {
                if (eventIsFull(selected)) {
                  return <p className="text-red-600 font-semibold">Fully booked — register for waitlist</p>
                }
                const remaining = eventSpotsRemaining(selected)
                if (remaining !== null && remaining > 0 && remaining <= 2) {
                  return <p className="text-red-600 font-semibold">Only {remaining} spot{remaining === 1 ? '' : 's'} remaining</p>
                }
                return null
              })()}
            </div>
            <button
              onClick={isBooked(selected) ? cancelBooking : startRegister}
              disabled={bookingLoading || (!isBooked(selected) && eventIsFull(selected))}
              className={`w-full py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                isBooked(selected)
                  ? 'bg-sky-100 hover:bg-red-100 text-red-700 border border-red-500'
                  : 'bg-blue-900 hover:bg-blue-950 text-white'
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
