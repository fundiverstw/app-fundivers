import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings, fetchEventsInRange, formatEventSpan } from '../lib/events'
import { RegisterFormBody, pendingBookingKey, type PendingBookingDraft } from '../components/register/RegisterForm'
import { sendRegistrationPdfEmail } from '../lib/registration-email'
import type { AppEvent, Booking, BookingDetails } from '../types/database'

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

type Phase = 'loading' | 'event-picker' | 'event-missing' | 'form' | 'already-booked' | 'just-booked' | 'pending-email'

export function RegisterPage() {
  const { type, id } = useParams<{ type: 'dive' | 'course'; id: string }>()
  const navigate = useNavigate()
  const { user, profile, loading: authLoading } = useAuth()

  const [event, setEvent] = useState<AppEvent | null>(null)
  const [existing, setExisting] = useState<Booking | null>(null)
  const [justBooked, setJustBooked] = useState<Booking | null>(null)
  const [dataLoading, setDataLoading] = useState(true)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)

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
    : pendingEmail                    ? 'pending-email'
    :                                   'form'

  // If the user returned via an email-confirmation link (now authed) and
  // we stashed a pending booking draft before they left, submit it so
  // the click completes both the account and the booking. Guarded on
  // `existing` so a duplicate draft can't double-insert.
  //
  // Source order: user.user_metadata.pending_booking (set via signUp's
  // options.data; survives a different device confirming the email),
  // then localStorage (in-flight drafts from before user_metadata was
  // adopted; fallback can be removed once nobody old is mid-flow).
  useEffect(() => {
    if (!user || !event || !type || existing || justBooked || dataLoading) return

    const meta = (user.user_metadata ?? {}) as { pending_booking?: PendingBookingDraft }
    const fromMeta = meta.pending_booking
    const matchesEvent = fromMeta && fromMeta.event_type === type && fromMeta.event_id === event.id

    let draft: PendingBookingDraft | null = null
    let consumedFromMeta = false
    if (matchesEvent) {
      draft = fromMeta!
      consumedFromMeta = true
    } else {
      const key = pendingBookingKey(event)
      const raw = (() => { try { return localStorage.getItem(key) } catch { return null } })()
      if (!raw) return
      // Remove synchronously before the await so StrictMode's double
      // mount in dev can't fire a second insert from the same draft.
      try { localStorage.removeItem(key) } catch { /* ignore */ }
      try { draft = JSON.parse(raw) as PendingBookingDraft } catch { return }
    }
    if (!draft) return
    const settledDraft = draft

    ;(async () => {
      await supabase.from('profiles').update(settledDraft.profilePatch).eq('id', user.id)
      const fk = type === 'dive'
        ? { eo_dive_id: event.id, eo_course_id: null }
        : { eo_dive_id: null, eo_course_id: event.id }
      const { data } = await supabase.from('bookings').insert({
        user_id: user.id,
        status: 'pending',
        notes: settledDraft.notes,
        details: settledDraft.details as BookingDetails,
        ...fk,
      }).select().single()
      if (data) {
        if (consumedFromMeta) {
          // Clear the metadata draft so AppShell's pending-booking
          // banner doesn't keep prompting after the booking landed.
          supabase.auth.updateUser({ data: { pending_booking: null } }).catch(() => { /* non-fatal */ })
        }
        sendRegistrationPdfEmail((data as { id: string }).id)
        setJustBooked(data as Booking)
      }
    })()
  }, [user, event, type, existing, justBooked, dataLoading])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <header className="border-b border-slate-800 px-4 py-3">
        <a href="https://fundiverstw.com" className="text-sky-400 font-bold text-lg">FunDivers TW</a>
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

        {phase === 'pending-email' && pendingEmail && event && (
          <PendingEmailScreen email={pendingEmail} event={event} />
        )}

        {phase === 'form' && event && (
          <>
            {!user && <SignInBanner />}
            <EventHeader event={event} />
            <div className="bg-slate-800 rounded-xl p-5">
              <RegisterFormBody
                event={event}
                profile={profile}
                userId={user?.id}
                onSubmitSuccess={b => setJustBooked(b as Booking)}
                onBackBeforeStepOne={() => navigate('/register')}
                onPendingEmailConfirmation={email => setPendingEmail(email)}
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
      <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; href: string } }) {
  return (
    <div className="text-center pt-12 space-y-4">
      <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
      <p className="text-slate-400 text-sm">{body}</p>
      {action && (
        <a href={action.href} className="inline-block bg-sky-500 hover:bg-sky-600 text-white font-semibold px-5 py-2 rounded-lg">
          {action.label}
        </a>
      )}
    </div>
  )
}

function EventHeader({ event }: { event: AppEvent }) {
  return (
    <div className="bg-slate-800 rounded-xl p-5 space-y-1">
      <p className="text-xs uppercase tracking-[0.25em] text-cyan-300/70">Register for</p>
      <h1 className="text-xl font-bold text-slate-100">{event.title}</h1>
      <p className="text-sm text-slate-400">
        {formatEventSpan(event, { style: 'long' })}
      </p>
      {event.price != null && (
        <p className="text-sm text-slate-300">From {event.currency} {event.price.toLocaleString()}</p>
      )}
    </div>
  )
}

function LockedConfirmation({ event, booking, alreadyExisting = false }: { event: AppEvent; booking: Booking; alreadyExisting?: boolean }) {
  return (
    <div className="bg-slate-800 rounded-xl p-6 space-y-4 text-center">
      <div className="text-5xl">{alreadyExisting ? '📋' : '✅'}</div>
      <h1 className="text-xl font-bold text-slate-100">
        {alreadyExisting ? "You're already registered" : 'Registration submitted'}
      </h1>
      <p className="text-sm text-slate-400">
        {event.title} · {formatEventSpan(event, { style: 'compact' })}
      </p>
      <div className="bg-slate-900/50 rounded-lg p-3 text-sm text-slate-300 text-left">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Status</p>
        <p className="capitalize">{booking.status}</p>
      </div>
      <p className="text-xs text-slate-500">
        Details are locked once submitted. Need a change? Contact FunDivers staff and they'll adjust it for you.
      </p>
      <Link to="/bookings" className="inline-block bg-sky-500 hover:bg-sky-600 text-white font-semibold px-5 py-2 rounded-lg">
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
    <div className="bg-slate-800 rounded-xl p-5 space-y-4">
      <header className="flex items-center justify-between">
        <span className="text-xs text-slate-400">Step 1 of 3</span>
      </header>
      <section className="space-y-2">
        <h2 className="text-lg font-bold text-slate-100">Which event?</h2>
        <p className="text-sm text-slate-400">
          Pick the dive or course you'd like to register for.
        </p>
      </section>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <p className="text-slate-500 text-sm">No upcoming events available right now.</p>
      ) : (
        <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
          {events.map(ev => (
            <li key={`${ev.type}_${ev.id}`}>
              <button
                type="button"
                onClick={() => navigate(`/register/${ev.type}/${ev.id}`)}
                className="w-full text-left bg-slate-900/50 hover:bg-slate-700 rounded-lg p-3 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${ev.type === 'dive' ? 'bg-sky-500' : 'bg-emerald-500'}`}>
                        {ev.type === 'dive' ? 'Dive' : 'Course'}
                      </span>
                      <span className="font-medium text-slate-100 text-sm truncate">{ev.title}</span>
                      {ev.featured && <span className="text-xs text-amber-400">★</span>}
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {formatEventSpan(ev)}
                    </p>
                  </div>
                  {ev.price != null && (
                    <div className="text-right shrink-0 text-xs text-slate-300">
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
    <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 text-sm">
      {!open ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-slate-300">Already have a FunDivers account?</span>
          <button
            onClick={() => setOpen(true)}
            className="text-sky-400 font-semibold hover:underline"
          >
            Sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-slate-200 font-semibold">Sign in</span>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-400 text-xs hover:text-slate-200">
              Cancel
            </button>
          </div>
          <input
            type="email" required placeholder="Email" value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500"
          />
          <input
            type="password" required placeholder="Password" value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500"
          />
          {err && <p className="text-rose-400 text-xs">{err}</p>}
          <button type="submit" disabled={busy} className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-semibold py-2 rounded-lg">
            {busy ? '…' : 'Sign in'}
          </button>
        </form>
      )}
    </div>
  )
}

// Shown after a guest submits the whole form but cloud returned no
// session (email confirmation required). The draft has been stashed to
// localStorage; on their return via the confirmation link, the effect
// in RegisterPage will auto-insert the booking.
function PendingEmailScreen({ email, event }: { email: string; event: AppEvent }) {
  return (
    <div className="bg-slate-800 rounded-xl p-6 space-y-3 text-center">
      <div className="text-5xl">📧</div>
      <h2 className="text-xl font-bold text-slate-100">Confirm your email to finish</h2>
      <p className="text-sm text-slate-400">
        We sent a confirmation link to <strong>{email}</strong>. Click it to confirm your
        account — your registration for <strong>{event.title}</strong> will be submitted
        automatically when you come back.
      </p>
    </div>
  )
}
