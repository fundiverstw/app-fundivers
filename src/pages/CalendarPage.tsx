import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { startOfMonth, endOfMonth } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsInRange, formatEventSpan, eventIsFull } from '../lib/events'
import { MonthCalendar } from '../components/calendar/MonthCalendar'
import { EventDetails } from '../components/calendar/EventDetails'
import { RegisterForm } from '../components/register/RegisterForm'
import { MultiRegisterForm } from '../components/register/MultiRegisterForm'
import { ShareEventButton } from '../components/ShareEventButton'
import { AddToGoogleCalendarButton } from '../components/AddToGoogleCalendarButton'
import { canSelfCancel } from '../lib/booking-status'
import { netPaidByBooking } from '../lib/payments'
import { t } from '../i18n'
import { BTN_XS_GHOST, ACTION_BAR, ACTION_BAR_CLEARANCE } from '../styles/tokens'
import type { AppEvent, Booking } from '../types/database'
import { EVENT_KIND_DOT, EVENT_KIND_LABELS } from '../lib/event-kind-labels'


function bookingMatches(b: Booking, ev: AppEvent) {
  return b.event_id === ev.id
}

export function CalendarPage() {
  const { user, profile } = useAuth()
  const [month, setMonth] = useState(new Date())
  const [events, setEvents] = useState<AppEvent[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  // Net paid per booking. The cancel control needs it: a booking with money on
  // it must go through the refund queue, never a one-tap self-cancel.
  const [paidByBooking, setPaidByBooking] = useState<Map<string, number>>(new Map())
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
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('bookings').select('*').eq('user_id', user.id)
      if (!alive) return
      const rows = data ?? []
      setBookings(rows)
      if (!rows.length) { setPaidByBooking(new Map()); return }
      const { data: payments } = await supabase
        .from('payments')
        .select('booking_id, amount, status')
        .in('booking_id', rows.map(b => b.id))
      if (alive) setPaidByBooking(netPaidByBooking(payments ?? []))
    })()
    return () => { alive = false }
  }, [user])

  function bookingFor(ev: AppEvent): Booking | null {
    return bookings.find(b => bookingMatches(b, ev) && b.status !== 'cancelled') ?? null
  }

  function isBooked(ev: AppEvent) {
    return bookingFor(ev) !== null
  }

  /** Self-cancel is only for an unpaid queue entry. Once money is on the
   *  booking the modal points at My Bookings instead, where "Request refund"
   *  puts it in front of an admin — cancelling here would strand the money on
   *  a booking that then reads as settled everywhere. Same rule as
   *  BookingsPage, via the shared helper, so the two controls cannot drift. */
  function canCancelHere(ev: AppEvent): boolean {
    const b = bookingFor(ev)
    return !!b && canSelfCancel(b, paidByBooking.get(b.id) ?? 0)
  }

  async function cancelBooking() {
    if (!user || !selected || !canCancelHere(selected)) return
    setBookingLoading(true)
    await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('user_id', user.id)
      .eq('event_id', selected.id)
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

  /** "Register for another event" on the confirmation panel. The booking just
   *  made is recorded exactly as Done records it; the calendar then opens in
   *  multi mode, so the next events are a tap each rather than another trip
   *  through the modal. */
  function handleRegisterAnother(booking: unknown) {
    handleBooked(booking)
    setCart([])
    setMode('multi')
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
    <div className={`max-w-2xl mx-auto ${mode === 'multi' ? ACTION_BAR_CLEARANCE : ''}`}>
      {user && mode === 'single' && (
        <button
          type="button"
          onClick={() => setMode('multi')}
          className="w-full mb-3 flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold py-2.5 px-4 rounded-xl shadow-md border-2 border-amber-500 transition-colors"
        >
          <span className="text-lg leading-none">+</span>
          {t.calendar.registerMultiple}
        </button>
      )}
      {user && mode === 'multi' && (
        <div className="mb-3 bg-amber-400/15 border border-amber-400/50 rounded-xl px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-amber-100 font-semibold">
            {t.calendar.multiModeHint}
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
            return <span className="text-xs text-red-600 font-semibold">{t.calendar.booked}</span>
          }
          if (mode === 'multi') {
            if (eventIsFull(ev)) {
              return <span className="text-xs text-brand-950/60 font-medium">{t.calendar.full}</span>
            }
            return cartIds.has(ev.id)
              ? <span className="text-xs text-emerald-700 font-semibold">{t.calendar.added}</span>
              : <span className="text-xs text-brand-900 font-medium">{t.calendar.add}</span>
          }
          return null
        }}
        hidePastInList
        disablePastEvents
      />

      {mode === 'multi' && (
        <div className={ACTION_BAR}>
          <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
            <div className="text-white text-sm">
              <p className="font-semibold">
                {t.calendar.eventsSelected(cart.length)}
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
                className={BTN_XS_GHOST}
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => setMultiRegistering(cart)}
                disabled={cart.length === 0}
                className="text-sm bg-reef-500 text-slate-950 hover:bg-reef-400 disabled:opacity-50 font-semibold px-3 py-1.5 rounded-lg"
              >
                {t.common.continue} →
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-brand-950/70 backdrop-blur-sm flex items-start justify-center z-50 px-4 pt-8 pb-4 overflow-y-auto" onClick={() => setSelected(null)}>
          <div className="glass glow-mauve rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full text-white ${EVENT_KIND_DOT[selected.type]}`}>
                {EVENT_KIND_LABELS[selected.type]}
              </span>
              <button onClick={() => setSelected(null)} className="text-brand-100/70 hover:text-white text-xl leading-none">×</button>
            </div>
            <h2 className="text-xl font-bold text-white">{selected.title}</h2>
            <div className="text-sm text-brand-100/90 font-medium space-y-1">
              <p>{formatEventSpan(selected, { style: 'long' })}</p>
              {selected.price != null && (
                <p>💰 {t.calendar.priceFrom(`${selected.currency} ${selected.price.toLocaleString()}`)}</p>
              )}
              {/* Capacity status is part of selected.title (set by the
                  display_title trigger). No separate badge needed. */}
            </div>
            {selected.details && <EventDetails details={selected.details} />}
            {/* Raw amber palette below, not the theme tokens: the "you already
                booked this" notice has to stay legible on both the light and
                dark modal surfaces, and the *-100 / *-900 status pair is the
                one combination index.css does not remap. */}
            {isBooked(selected) && !canCancelHere(selected) ? (
              <div className="rounded-xl border border-amber-400 bg-amber-100 px-3 py-3 space-y-1">
                <p className="text-sm font-semibold text-amber-900">{t.calendar.bookedAlready}</p>
                <p className="text-xs text-amber-900">{t.calendar.cancelViaBookings}</p>
                <Link to="/bookings" className="text-xs font-semibold text-amber-900 underline hover:text-amber-950 inline-block">
                  {t.calendar.goToBookings}
                </Link>
              </div>
            ) : (
              <button
                onClick={isBooked(selected) ? cancelBooking : startRegister}
                disabled={bookingLoading || (!isBooked(selected) && eventIsFull(selected))}
                className={`w-full py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                  isBooked(selected)
                    ? 'bg-red-500/15 hover:bg-red-500/25 text-red-200 border border-red-400/40'
                    : 'bg-reef-500 hover:bg-reef-400 text-slate-950'
                }`}
              >
                {bookingLoading ? '…' : isBooked(selected) ? t.calendar.cancelBooking : t.common.register}
              </button>
            )}
            <AddToGoogleCalendarButton
              event={selected}
              className="w-full py-2 rounded-xl text-sm font-semibold bg-surface-700 hover:bg-surface-800 text-white transition-colors inline-flex items-center justify-center"
            />
            <ShareEventButton
              eventId={selected.id}
              label={t.calendar.shareWithFriends}
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
          onRegisterAnother={handleRegisterAnother}
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
