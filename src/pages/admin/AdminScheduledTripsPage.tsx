import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchEventsInRange, formatEventSpan } from '../../lib/events'
import { dayKeyOffset } from '../../lib/logistics'
import {
  fetchAllScheduledTrips, saveScheduledTrip, setScheduledTripStatus, deleteScheduledTrip,
} from '../../lib/scheduled-trips-admin'
import type {
  ScheduledTrip, ScheduledTripInsert, ScheduledTripStatus, AppEvent,
} from '../../types/database'
import { BTN_SECONDARY } from '../../styles/tokens'

// Admin catalog for Scheduled Trips — the shop's own curated, dated trips. The
// diver-facing Scheduled Trips tab reads the published rows; each trip can link
// to a bookable catalog event so "Register" routes into the normal booking
// flow. The admin counterpart of the diver Scheduled Trips page.

// How far ahead to offer catalog events for the optional registration link.
const EVENT_LOOKAHEAD_DAYS = 365
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminScheduledTripsPage() {
  const toast = useToast()
  const [trips, setTrips] = useState<ScheduledTrip[]>([])
  const [events, setEvents] = useState<AppEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ScheduledTrip | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ScheduledTrip | null>(null)

  async function reloadTrips() {
    try {
      setTrips(await fetchAllScheduledTrips())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone })
        const [t, e] = await Promise.all([
          fetchAllScheduledTrips(),
          fetchEventsInRange(today, dayKeyOffset(today, EVENT_LOOKAHEAD_DAYS), { includePrivate: true }),
        ])
        if (cancelled) return
        setTrips(t)
        setEvents(e)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const eventLabel = (id: string | null) => {
    if (!id) return null
    const e = events.find(ev => ev.id === id)
    return e ? `${e.title} · ${formatEventSpan(e, { withYear: true })}` : '(event removed)'
  }

  async function changeStatus(trip: ScheduledTrip, status: ScheduledTripStatus) {
    try {
      await setScheduledTripStatus(trip, status)
      toast.success(`Trip ${status}`)
      await reloadTrips()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function handleDelete(trip: ScheduledTrip) {
    try {
      await deleteScheduledTrip(trip.id)
      toast.success('Trip deleted')
      setConfirmDelete(null)
      await reloadTrips()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Scheduled Trips</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          + New trip
        </button>
      </div>
      <p className="text-sm text-white/80">
        The shop's own dated trips shown on the diver Scheduled Trips tab. Link a
        trip to a catalog event so divers can register in-app; leave it unlinked
        for an informational listing that points them at Contact.
      </p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">Loading…</p>
      ) : trips.length === 0 ? (
        <p className="text-sm text-white/70">No scheduled trips yet — add the shop's first one.</p>
      ) : (
        <ul className="space-y-2">
          {trips.map(trip => (
            <li key={trip.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-900 text-sm truncate">{trip.title}</p>
                  <p className="text-xs text-brand-900/80 truncate">
                    {trip.destination}
                    {trip.event_id ? ` · ${eventLabel(trip.event_id)}` : ' · not linked (informational)'}
                  </p>
                </div>
                <StatusBadge status={trip.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                {trip.status !== 'published' && (
                  <button type="button" onClick={() => changeStatus(trip, 'published')}
                    className="text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 rounded-lg">Publish</button>
                )}
                {trip.status === 'published' && (
                  <button type="button" onClick={() => changeStatus(trip, 'draft')}
                    className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg">Unpublish</button>
                )}
                {trip.status !== 'archived' && (
                  <button type="button" onClick={() => changeStatus(trip, 'archived')}
                    className="text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white px-2.5 py-1 rounded-lg">Archive</button>
                )}
                <button type="button" onClick={() => setEditing(trip)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-2.5 py-1 rounded-lg">Edit</button>
                <button type="button" onClick={() => setConfirmDelete(trip)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-2.5 py-1 rounded-lg">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <TripForm
          trip={editing} events={events}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success('Trip saved'); await reloadTrips() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete scheduled trip?"
          body={`"${confirmDelete.title}" will be removed. To hide it from divers but keep the record, archive it instead.`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: ScheduledTripStatus }) {
  const cls = status === 'published'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : status === 'draft'
      ? 'bg-amber-100 text-amber-800 border-amber-300'
      : 'bg-slate-100 text-slate-700 border-slate-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>{status}</span>
}

function TripForm({
  trip, events, onClose, onSaved, onError,
}: {
  trip: ScheduledTrip | null
  events: AppEvent[]
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [title, setTitle] = useState(trip?.title ?? '')
  const [destination, setDestination] = useState(trip?.destination ?? '')
  const [summary, setSummary] = useState(trip?.summary ?? '')
  const [description, setDescription] = useState(trip?.description ?? '')
  const [startDate, setStartDate] = useState(trip?.start_date ?? '')
  const [endDate, setEndDate] = useState(trip?.end_date ?? '')
  const [price, setPrice] = useState(trip?.price?.toString() ?? '')
  const [currency, setCurrency] = useState(trip?.currency ?? siteConfig.locale.currency)
  const [heroImageUrl, setHeroImageUrl] = useState(trip?.hero_image_url ?? '')
  const [highlights, setHighlights] = useState((trip?.highlights ?? []).join('\n'))
  const [eventId, setEventId] = useState(trip?.event_id ?? '')
  const [status, setStatus] = useState<ScheduledTripStatus>(trip?.status ?? 'draft')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !destination.trim()) { onError('Title and destination are required.'); return }
    if (startDate && endDate && endDate < startDate) { onError('End date is before the start date.'); return }
    setSubmitting(true)
    try {
      const values: ScheduledTripInsert = {
        title: title.trim(),
        destination: destination.trim(),
        summary: summary.trim() || null,
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        price: price.trim() === '' ? null : Number(price),
        currency: currency.trim() || siteConfig.locale.currency,
        hero_image_url: heroImageUrl.trim() || null,
        highlights: highlights.split('\n').map(h => h.trim()).filter(Boolean),
        event_id: eventId || null,
        status,
      }
      await saveScheduledTrip(values, trip ?? undefined)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="scheduled-trip-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3 max-h-[80vh] overflow-y-auto">
        <h2 id="scheduled-trip-form-title" className="text-lg font-bold text-brand-900">{trip ? 'Edit trip' : 'New trip'}</h2>
        <Labelled label="Title *"><input className={FIELD} value={title} onChange={e => setTitle(e.target.value)} /></Labelled>
        <Labelled label="Destination *"><input className={FIELD} value={destination} onChange={e => setDestination(e.target.value)} /></Labelled>
        <Labelled label="Summary (one line on the card)">
          <input className={FIELD} value={summary} onChange={e => setSummary(e.target.value)} />
        </Labelled>
        <Labelled label="Description">
          <textarea className={`${FIELD} resize-none`} rows={3} value={description} onChange={e => setDescription(e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Start date"><input className={FIELD} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></Labelled>
          <Labelled label="End date"><input className={FIELD} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></Labelled>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Price"><input className={FIELD} type="number" step="any" value={price} onChange={e => setPrice(e.target.value)} /></Labelled>
          <Labelled label="Currency"><input className={FIELD} value={currency} onChange={e => setCurrency(e.target.value)} /></Labelled>
        </div>
        <Labelled label="Hero image URL"><input className={FIELD} value={heroImageUrl} onChange={e => setHeroImageUrl(e.target.value)} /></Labelled>
        <Labelled label="Highlights (one per line)">
          <textarea className={`${FIELD} resize-none`} rows={3} value={highlights} onChange={e => setHighlights(e.target.value)} />
        </Labelled>
        <Labelled label="Register via event (optional)">
          <select className={FIELD} value={eventId} onChange={e => setEventId(e.target.value)} aria-label="Register via event">
            <option value="">— none (informational, links to Contact) —</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.title} · {formatEventSpan(ev, { withYear: true })}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label="Status">
          <select className={FIELD} value={status} onChange={e => setStatus(e.target.value as ScheduledTripStatus)} aria-label="Status">
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </Labelled>
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className={`flex-1 ${BTN_SECONDARY}`}>Cancel</button>
          <button type="submit" disabled={submitting}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50">
            {submitting ? 'Saving…' : (trip ? 'Save changes' : 'Create trip')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-brand-900">{label}</span>
      {children}
    </label>
  )
}

function ConfirmModal({
  title, body, confirmLabel, onClose, onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal labelledBy="confirm-title" onClose={onClose}>
      <h2 id="confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
      <p className="text-sm text-brand-900">{body}</p>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose}
          className="flex-1 py-2 rounded-lg text-sm font-medium text-brand-900 border border-surface-300 hover:bg-surface-50">Cancel</button>
        <button type="button" onClick={onConfirm}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-red-700 hover:bg-red-800">{confirmLabel}</button>
      </div>
    </Modal>
  )
}

function Modal({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
