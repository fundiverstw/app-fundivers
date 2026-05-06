import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings, fetchEventsInRange, formatEventSpan } from '../lib/events'
import { RegisterFormBody } from '../components/register/RegisterForm'
import { Logo } from '../components/Logo'
import type { AppEvent, Booking } from '../types/database'

// Public standalone registration page. Two entry paths:
//   /register                 → event picker (Wix home link, direct URL)
//   /register/:type/:id       → form pre-filled with that event (Wix calendar
//                                deep-link, in-app event click)
//
// Both render this component. When no event is in the URL we show the picker
// framed as step 1 of the form; clicking an event navigates to the pre-filled
// variant rather than setting local state, so the URL stays bookmarkable.
//
// No AppShell chrome — feels like a marketing-funnel landing page for divers
// arriving from fundiverstw.com, not an app screen.

type Phase = 'loading' | 'event-picker' | 'event-missing' | 'form' | 'already-booked' | 'just-booked'

export function RegisterPage() {
  const { type, id } = useParams<{ type: 'dive' | 'course'; id: string }>()
  const navigate = useNavigate()
  const { user, profile, loading: authLoading } = useAuth()

  const [event, setEvent] = useState<AppEvent | null>(null)
  const [existing, setExisting] = useState<Booking | null>(null)
  const [justBooked, setJustBooked] = useState<Booking | null>(null)
  const [dataLoading, setDataLoading] = useState(true)

  // Only fetch the specific event when :type/:id are in the URL. For the bare
  // /register path we don't fetch one event; the picker fetches a list.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setDataLoading(true)

      if (!type || !id) {
        setEvent(null)
        setExisting(null)
        setDataLoading(false)
        return
      }

      const eventMap = await fetchEventsForBookings(
        type === 'dive'   ? [id] : [],
        type === 'course' ? [id] : [],
      )
      if (cancelled) return
      setEvent(eventMap.get(id) ?? null)

      if (user) {
        const col = type === 'dive' ? 'eo_dive_id' : 'eo_course_id'
        const { data } = await supabase
          .from('bookings')
          .select('*')
          .eq('user_id', user.id)
          .eq(col, id)
          .neq('status', 'cancelled')
          .maybeSingle()
        if (!cancelled) setExisting(data)
      } else {
        setExisting(null)
      }

      setDataLoading(false)
    })()
    return () => { cancelled = true }
  }, [type, id, user])

  const phase: Phase =
    authLoading || dataLoading        ? 'loading'
    : !type || !id                    ? 'event-picker'
    : !event                          ? 'event-missing'
    : justBooked                      ? 'just-booked'
    : existing                        ? 'already-booked'
    :                                   'form'

  return (
    <div className="min-h-screen bg-sky-50 text-blue-900">
      <header className="bg-blue-950 border-b border-red-500 px-4 py-3">
        <a href="https://fundiverstw.com" aria-label="FunDivers Taiwan home"><Logo size="sm" /></a>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-5">
        {phase === 'loading' && <Spinner />}

        {phase === 'event-picker' && <EventPickerStep />}

        {phase === 'event-missing' && (
          <EmptyState
            title="Event not found"
            body="That event isn't available anymore. Pick another from the list."
            action={{ label: 'Back to events', href: '/register' }}
          />
        )}

        {phase === 'just-booked' && event && justBooked && (
          <LockedConfirmation event={event} booking={justBooked} />
        )}

        {phase === 'already-booked' && event && existing && (
          <LockedConfirmation event={event} booking={existing} alreadyExisting />
        )}

        {phase === 'form' && event && (
          <>
            {!user && <SignInBanner />}
            <EventHeader event={event} />
            <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-5">
              <RegisterFormBody
                event={event}
                profile={profile}
                userId={user?.id}
                onSubmitSuccess={b => setJustBooked(b as Booking)}
                onBackBeforeStepOne={() => navigate('/register')}
              />
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex justify-center pt-12">
      <div className="w-6 h-6 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; href: string } }) {
  return (
    <div className="text-center pt-12 space-y-4">
      <h1 className="text-2xl font-bold text-blue-900">{title}</h1>
      <p className="text-blue-900 font-medium text-sm">{body}</p>
      {action && (
        <a href={action.href} className="inline-block bg-blue-900 hover:bg-blue-950 text-white font-semibold px-5 py-2 rounded-lg">
          {action.label}
        </a>
      )}
    </div>
  )
}

function EventHeader({ event }: { event: AppEvent }) {
  return (
    <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-5 space-y-1">
      <p className="text-xs uppercase tracking-[0.25em] text-red-600">Register for</p>
      <h1 className="text-xl font-bold text-blue-900">{event.title}</h1>
      <p className="text-sm text-blue-900 font-medium">
        {formatEventSpan(event, { style: 'long' })}
      </p>
      {event.price != null && (
        <p className="text-sm text-blue-900">From {event.currency} {event.price.toLocaleString()}</p>
      )}
    </div>
  )
}

function LockedConfirmation({ event, booking, alreadyExisting = false }: { event: AppEvent; booking: Booking; alreadyExisting?: boolean }) {
  const isWaitlisted = booking.status === 'waitlisted'
  const heading = alreadyExisting
    ? "You're already registered"
    : isWaitlisted
      ? "You've been added to the waitlist"
      : 'Your registration has been submitted'
  return (
    <div className="bg-white border border-red-500 rounded-xl p-6 space-y-4 text-center shadow-lg">
      <h1 className="text-xl font-bold text-blue-900">{heading}</h1>
      <p className="text-sm text-blue-900 font-medium">
        {event.title} · {formatEventSpan(event, { style: 'compact' })}
      </p>
      <div className="bg-sky-50 rounded-lg p-3 text-sm text-blue-900 text-left">
        <p className="text-xs text-blue-950 font-medium uppercase tracking-wider mb-1">Status</p>
        <p className="capitalize">{booking.status}</p>
      </div>
      {isWaitlisted ? (
        <p className="text-xs text-blue-950 font-medium">
          We'll send you a push notification and an email if a spot opens up. You'll have 24 hours to accept before the offer rolls to the next person on the list.
        </p>
      ) : (
        <p className="text-xs text-blue-950 font-medium">
          Sign in any time at <a href="https://app.fundiverstw.com" className="text-blue-700 hover:underline">app.fundiverstw.com</a> to track your booking and payment status.
        </p>
      )}
      <Link to="/records/bookings" className="inline-block bg-blue-900 hover:bg-blue-950 text-white font-semibold px-5 py-2 rounded-lg">
        View my bookings
      </Link>
    </div>
  )
}

// Event-picker phase — shown when /register is opened without a specific
// event in the URL. Framed as "step 1 of the form" so a visitor sees
// continuous progress rather than feeling handed off between screens.
function EventPickerStep() {
  const navigate = useNavigate()
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const today = new Date()
      const end = new Date(today); end.setMonth(end.getMonth() + 3)
      const iso = (d: Date) => d.toISOString().slice(0, 10)
      const evs = await fetchEventsInRange(iso(today), iso(end))
      if (cancelled) return
      const upcoming = evs.filter(e => new Date(e.start_time) >= today && !e.fully_booked)
      setEvents(upcoming)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-5 space-y-4">
      <header className="flex items-center justify-between">
        <span className="text-xs text-blue-900 font-medium">Step 1 of 3</span>
      </header>
      <section className="space-y-2">
        <h2 className="text-lg font-bold text-blue-900">Which event?</h2>
        <p className="text-sm text-blue-900 font-medium">
          Pick the dive or course you'd like to register for.
        </p>
      </section>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-blue-950 font-medium text-sm">No upcoming events available right now.</p>
      ) : (
        <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
          {events.map(ev => (
            <li key={`${ev.type}_${ev.id}`}>
              <button
                type="button"
                onClick={() => navigate(`/register/${ev.type}/${ev.id}`)}
                className="w-full text-left bg-white/70 backdrop-blur-md border border-sky-200 hover:border-red-500 rounded-lg p-3 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${ev.type === 'dive' ? 'bg-emerald-600' : 'bg-sky-500'}`}>
                        {ev.type === 'dive' ? 'Dive' : 'Course'}
                      </span>
                      <span className="font-medium text-blue-900 text-sm truncate">{ev.title}</span>
                      {ev.featured && <span className="text-xs text-red-600">★</span>}
                    </div>
                    <p className="text-xs text-blue-900 font-medium mt-1">
                      {formatEventSpan(ev)}
                    </p>
                  </div>
                  {ev.price != null && (
                    <div className="text-right shrink-0 text-xs text-blue-900">
                      From {ev.currency} {ev.price.toLocaleString()}
                    </div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Collapsible banner shown at the top of the form for unauthed visitors.
// Most guests will just fill in the form; returning divers without a
// session on this device expand it and sign in to pre-fill the form.
function SignInBanner() {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setErr(error.message)
    // On success the useAuth subscription will flip the page into authed
    // mode and the form re-renders with pre-filled profile values.
  }

  return (
    <div className="bg-white/65 backdrop-blur-md border border-red-500 rounded-xl p-3 text-sm">
      {!open ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-blue-900">Already have a FunDivers account?</span>
          <button
            onClick={() => setOpen(true)}
            className="text-blue-700 font-semibold hover:underline"
          >
            Sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-blue-900 font-semibold">Sign in</span>
            <button type="button" onClick={() => setOpen(false)} className="text-blue-900 font-medium text-xs hover:text-blue-900">
              Cancel
            </button>
          </div>
          <input
            type="email" required placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-white border border-sky-300 rounded-lg px-3 py-2 text-blue-900 focus:outline-none focus:border-blue-900"
          />
          <input
            type="password" required placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-white border border-sky-300 rounded-lg px-3 py-2 text-blue-900 focus:outline-none focus:border-blue-900"
          />
          {err && <p className="text-red-600 text-xs">{err}</p>}
          <button type="submit" disabled={busy} className="w-full bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white font-semibold py-2 rounded-lg">
            {busy ? '…' : 'Sign in'}
          </button>
          <p className="text-center text-xs">
            <Link to="/forgot-password" className="text-blue-700 hover:underline">Forgot password?</Link>
          </p>
        </form>
      )}
    </div>
  )
}

