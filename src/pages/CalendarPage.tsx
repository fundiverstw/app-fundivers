import { useEffect, useMemo, useState } from 'react'
import { startOfMonth, endOfMonth } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsInRange, formatEventSpan, eventIsFull } from '../lib/events'
import { MonthCalendar } from '../components/calendar/MonthCalendar'
import { EventDetails } from '../components/calendar/EventDetails'
import { RegisterForm } from '../components/register/RegisterForm'
import { MultiRegisterForm } from '../components/register/MultiRegisterForm'
import { ShareEventButton } from '../components/ShareEventButton'
import type { AppEvent, Booking } from '../types/database'

const TYPE_DOT: Record<AppEvent['type'], string> = {
  dive:   'bg-emerald-600',
  course: 'bg-surface-500',
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
  // Multi-event registration mode. In 'multi' mode, clicking a calendar
  // event toggles its membership in `cart` instead of opening the detail
  // modal. The Continue button opens MultiRegisterForm with the full cart.
  // Guests (no `user`) can't enter multi mode — feature is signed-in only.
  const [mode, setMode] = useState<'single' | 'multi'>('single')
  const [cart, setCart] = useState<AppEvent[]>([])
  const [multiRegistering, setMultiRegistering] = useState<AppEvent[] | null>(null)
  const cartIds = useMemo(() => new Set(cart.map(e => e.id)), [cart])

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

  function toggleCart(ev: AppEvent) {
    setCart(prev => prev.some(e => e.id === ev.id)
      ? prev.filter(e => e.id !== ev.id)
      : [...prev, ev])
  }

  function exitMulti() {
    setMode('single')
    setCart([])
  }

  function handleMultiBooked(newBookings: Booking[]) {
    setBookings(prev => [...prev, ...newBookings])
    setMultiRegistering(null)
    exitMulti()
  }

  return (
    <div className="max-w-lg mx-auto">
      {user && mode === 'single' && (
        <button
          type="button"
          onClick={() => setMode('multi')}
          className="w-full mb-3 flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 text-brand-950 font-bold py-2.5 px-4 rounded-xl shadow-md border-2 border-amber-500 transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          Register for multiple events
        </button>
      )}
      {user && mode === 'multi' && (
        <div className="mb-3 bg-amber-100 border-2 border-amber-400 rounded-xl px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-brand-950 font-semibold">
            Multi-event mode — tap events to add. Already-booked or full events can't be added.
          </p>
        </div>
      )}

      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        events={events}
        highlightedIds={mode === 'multi' ? cartIds : undefined}
        onPickEvent={ev => {
          if (mode === 'multi') {
            if (isBooked(ev) || eventIsFull(ev)) return
            toggleCart(ev)
            return
          }
          setSelected(ev)
        }}
        renderListBadge={ev => {
          if (isBooked(ev)) {
            return <span className="text-xs text-red-600 font-semibold">Booked</span>
          }
          if (mode === 'multi') {
            if (eventIsFull(ev)) {
              return <span className="text-xs text-brand-950/60 font-medium">Full</span>
            }
            return cartIds.has(ev.id)
              ? <span className="text-xs text-emerald-700 font-semibold">Added</span>
              : <span className="text-xs text-brand-900 font-medium">+ Add</span>
          }
          return null
        }}
        hidePastInList
        disablePastEvents
      />

      {mode === 'multi' && (
        <div className="fixed inset-x-0 bottom-0 bg-brand-900/95 backdrop-blur-md border-t border-brand-950 px-4 py-3 z-40">
          <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
            <div className="text-white text-sm">
              <p className="font-semibold">
                {cart.length} event{cart.length === 1 ? '' : 's'} selected
              </p>
              {cart.length > 0 && (
                <p className="text-xs text-white/80 truncate max-w-[18rem]">
                  {cart.map(e => e.title).join(' · ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={exitMulti}
                className="text-xs text-white/80 hover:text-white px-2 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setMultiRegistering(cart)}
                disabled={cart.length === 0}
                className="text-sm bg-white text-brand-900 hover:bg-surface-50 disabled:opacity-50 font-semibold px-3 py-1.5 rounded-lg"
              >
                Continue →
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-start justify-center z-50 px-4 pt-8 pb-4 overflow-y-auto" onClick={() => setSelected(null)}>
          <div className="bg-white/75 backdrop-blur-md border border-accent rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full text-white ${TYPE_DOT[selected.type]}`}>
                {TYPE_LABELS[selected.type]}
              </span>
              <button onClick={() => setSelected(null)} className="text-brand-900 font-medium hover:text-brand-900 text-xl leading-none">×</button>
            </div>
            <h2 className="text-xl font-bold text-brand-900">{selected.title}</h2>
            <div className="text-sm text-brand-900 font-medium space-y-1">
              <p>{formatEventSpan(selected, { style: 'long' })}</p>
              {selected.price != null && (
                <p>💰 From {selected.currency} {selected.price.toLocaleString()}</p>
              )}
              {/* Capacity status is part of selected.title (set by the
                  display_title trigger). No separate badge needed. */}
            </div>
            {selected.details && <EventDetails details={selected.details} />}
            <button
              onClick={isBooked(selected) ? cancelBooking : startRegister}
              disabled={bookingLoading || (!isBooked(selected) && eventIsFull(selected))}
              className={`w-full py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                isBooked(selected)
                  ? 'bg-surface-100 hover:bg-red-100 text-red-700 border border-accent'
                  : 'bg-brand-900 hover:bg-brand-950 text-white'
              }`}
            >
              {bookingLoading ? '…' : isBooked(selected) ? 'Cancel booking' : 'Register'}
            </button>
            <ShareEventButton
              event={selected}
              label="Share link with friends"
              className="w-full py-2 rounded-xl text-sm font-semibold bg-surface-700 hover:bg-surface-800 text-white transition-colors"
            />
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
          inlineConfirmation
        />
      )}

      {multiRegistering && user && (
        <MultiRegisterForm
          events={multiRegistering}
          profile={profile}
          userId={user.id}
          onClose={() => setMultiRegistering(null)}
          onAllBooked={handleMultiBooked}
        />
      )}
    </div>
  )
}
