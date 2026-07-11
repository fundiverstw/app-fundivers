import { useEffect, useState } from 'react'
import { isoDate as iso } from '../lib/dates'
import { Spinner, PageLoading } from '../components/ui/Spinner'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings, fetchEventsInRange, formatEventSpan } from '../lib/events'
import { RegisterFormBody } from '../components/register/RegisterForm'
import { WhatHappensNext } from '../components/register/WhatHappensNext'
import { Logo } from '../components/Logo'
import { PasswordInput } from '../components/PasswordInput'
import { siteConfig } from '../config/site'
import { registrationDraftKey, loadRegistrationDraft } from '../lib/registration-draft'
import type { AppEvent, Booking } from '../types/database'
import { t } from '../i18n'

const rp = t.registerPage

// Public standalone registration page. Two entry paths:
//   /register                 → event picker (Wix home link, direct URL)
//   /register/:id             → form pre-filled with that event (Wix calendar
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
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, profile, loading: authLoading } = useAuth()

  const [event, setEvent] = useState<AppEvent | null>(null)
  const [existing, setExisting] = useState<Booking | null>(null)
  const [justBooked, setJustBooked] = useState<Booking | null>(null)
  const [dataLoading, setDataLoading] = useState(true)

  // Only fetch the specific event when :id is in the URL. For the bare
  // /register path we don't fetch one event; the picker fetches a list.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setDataLoading(true)

      if (!id) {
        setEvent(null)
        setExisting(null)
        setDataLoading(false)
        return
      }

      const eventMap = await fetchEventsForBookings([id])
      if (cancelled) return
      setEvent(eventMap.get(id) ?? null)

      if (user) {
        const { data } = await supabase
          .from('bookings')
          .select('*')
          .eq('user_id', user.id)
          .eq('event_id', id)
          .neq('status', 'cancelled')
          .maybeSingle()
        if (!cancelled) setExisting(data)
      } else {
        setExisting(null)
      }

      setDataLoading(false)
    })()
    return () => { cancelled = true }
  }, [id, user])

  const phase: Phase =
    authLoading || dataLoading        ? 'loading'
    : !id                             ? 'event-picker'
    : !event                          ? 'event-missing'
    : justBooked                      ? 'just-booked'
    : existing                        ? 'already-booked'
    :                                   'form'

  return (
    <div className="min-h-screen bg-surface-50 text-brand-900">
      <header className="bg-brand-950 border-b border-accent px-4 py-3">
        <a href={siteConfig.urls.site} aria-label={`${siteConfig.identity.logoAlt} home`}><Logo size="sm" /></a>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-5">
        {phase === 'loading' && <PageLoading />}

        {phase === 'event-picker' && <EventPickerStep />}

        {phase === 'event-missing' && (
          <EmptyState
            title={rp.eventNotFound}
            body={rp.eventNotFoundBody}
            action={{ label: rp.backToEvents, href: '/register' }}
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
            <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-5">
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

function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; href: string } }) {
  return (
    <div className="text-center pt-12 space-y-4">
      <h1 className="text-2xl font-bold text-brand-900">{title}</h1>
      <p className="text-brand-900 font-medium text-sm">{body}</p>
      {action && (
        <a href={action.href} className="inline-block bg-brand-900 hover:bg-brand-950 text-white font-semibold px-5 py-2 rounded-lg">
          {action.label}
        </a>
      )}
    </div>
  )
}

function EventHeader({ event }: { event: AppEvent }) {
  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-5 space-y-1">
      <p className="text-xs uppercase tracking-[0.25em] text-red-600">{rp.registerFor}</p>
      <h1 className="text-xl font-bold text-brand-900">{event.title}</h1>
      <p className="text-sm text-brand-900 font-medium">
        {formatEventSpan(event, { style: 'long' })}
      </p>
      {event.price != null && (
        <p className="text-sm text-brand-900">{rp.fromPrice(event.currency, event.price.toLocaleString())}</p>
      )}
    </div>
  )
}

function LockedConfirmation({ event, booking, alreadyExisting = false }: { event: AppEvent; booking: Booking; alreadyExisting?: boolean }) {
  const isWaitlisted = booking.status === 'waitlisted'
  const heading = alreadyExisting
    ? rp.alreadyRegistered
    : isWaitlisted
      ? rp.addedToWaitlist
      : rp.submitted
  return (
    <div className="bg-white border border-accent rounded-xl p-6 space-y-4 text-center shadow-lg">
      <h1 className="text-xl font-bold text-brand-900">{heading}</h1>
      <p className="text-sm text-brand-900 font-medium">
        {event.title} · {formatEventSpan(event, { style: 'compact' })}
      </p>
      <div className="bg-surface-50 rounded-lg p-3 text-sm text-brand-900 text-left">
        <p className="text-xs text-brand-950 font-medium uppercase tracking-wider mb-1">{rp.statusLabel}</p>
        <p className="capitalize">{booking.status}</p>
      </div>
      {alreadyExisting ? (
        <p className="text-xs text-brand-950 font-medium">
          {rp.signInAnyTime(siteConfig.urls.app.replace(/^https?:\/\//, ''))}
        </p>
      ) : (
        <WhatHappensNext waitlisted={isWaitlisted} />
      )}
      <Link to="/records/bookings" className="inline-block bg-brand-900 hover:bg-brand-950 text-white font-semibold px-5 py-2 rounded-lg">
        {rp.viewMyBookings}
      </Link>
    </div>
  )
}

// Event-picker phase — shown when /register is opened without a specific
// event in the URL. Framed as "step 1 of the form" so a visitor sees
// continuous progress rather than feeling handed off between screens.
function EventPickerStep() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const today = new Date()
      const end = new Date(today); end.setMonth(end.getMonth() + 3)
      const evs = await fetchEventsInRange(iso(today), iso(end))
      if (cancelled) return
      const upcoming = evs.filter(e => new Date(e.start_time) >= today && !e.fully_booked)
      setEvents(upcoming)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  // Upcoming events this device has an in-progress draft for (keyed to the
  // current viewer, so a guest's draft never surfaces for a signed-in diver).
  const resumable = events.filter(
    e => !!loadRegistrationDraft(registrationDraftKey(e.type, e.id, user?.id ?? null)),
  )

  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-5 space-y-4">
      <header className="flex items-center justify-between">
        <span className="text-xs text-brand-900 font-medium">{rp.stepOf}</span>
      </header>

      {resumable.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-brand-900">{rp.continueWhereLeftOff}</h2>
          <ul className="space-y-2">
            {resumable.map(ev => (
              <li key={`resume_${ev.type}_${ev.id}`}>
                <button
                  type="button"
                  onClick={() => navigate(`/register/${ev.id}`)}
                  className="w-full text-left bg-accent/15 border border-accent hover:border-brand-700 rounded-lg p-3 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <span className="font-medium text-brand-900 text-sm truncate block">{ev.title}</span>
                    <span className="text-xs text-brand-900 font-medium">{formatEventSpan(ev)}</span>
                  </div>
                  <span className="text-xs text-brand-700 font-semibold shrink-0">{rp.resume}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-lg font-bold text-brand-900">{rp.whichEvent}</h2>
        <p className="text-sm text-brand-900 font-medium">{rp.whichEventBody}</p>
      </section>

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : events.length === 0 ? (
        <p className="text-brand-950 font-medium text-sm">{rp.noUpcoming}</p>
      ) : (
        <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
          {events.map(ev => (
            <li key={`${ev.type}_${ev.id}`}>
              <button
                type="button"
                onClick={() => navigate(`/register/${ev.id}`)}
                className="w-full text-left bg-white/70 backdrop-blur-md border border-surface-200 hover:border-accent rounded-lg p-3 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${ev.type === 'dive' ? 'bg-emerald-600' : 'bg-surface-500'}`}>
                        {ev.type === 'dive' ? t.calendar.typeDive : t.calendar.typeCourse}
                      </span>
                      <span className="font-medium text-brand-900 text-sm truncate">{ev.title}</span>
                      {ev.featured && <span className="text-xs text-red-600">★</span>}
                    </div>
                    <p className="text-xs text-brand-900 font-medium mt-1">
                      {formatEventSpan(ev)}
                    </p>
                  </div>
                  {ev.price != null && (
                    <div className="text-right shrink-0 text-xs text-brand-900">
                      {rp.fromPrice(ev.currency, ev.price.toLocaleString())}
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
    <div className="bg-white/65 backdrop-blur-md border border-accent rounded-xl p-3 text-sm">
      {!open ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-brand-900">{rp.alreadyHaveAccount(siteConfig.identity.shortName)}</span>
          <button
            onClick={() => setOpen(true)}
            className="text-brand-700 font-semibold hover:underline"
          >
            {t.auth.signIn}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-brand-900 font-semibold">{t.auth.signIn}</span>
            <button type="button" onClick={() => setOpen(false)} className="text-brand-900 font-medium text-xs hover:text-brand-900">
              {t.common.cancel}
            </button>
          </div>
          <input
            type="email" required placeholder={t.auth.email} value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 focus:outline-none focus:border-brand-900"
          />
          <PasswordInput
            required placeholder={t.auth.password} value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 focus:outline-none focus:border-brand-900"
          />
          {err && <p className="text-red-600 text-xs">{err}</p>}
          <button type="submit" disabled={busy} className="w-full bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold py-2 rounded-lg">
            {busy ? rp.signingIn : t.auth.signIn}
          </button>
          <p className="text-center text-xs">
            <Link to="/forgot-password" className="text-brand-700 hover:underline">{t.auth.forgotPassword}</Link>
          </p>
        </form>
      )}
    </div>
  )
}

