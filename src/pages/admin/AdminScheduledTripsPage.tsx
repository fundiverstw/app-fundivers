import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import {
  fetchAllScheduledTrips, saveScheduledTrip, setScheduledTripStatus, deleteScheduledTrip,
} from '../../lib/scheduled-trips-admin'
import { countNewRegistrations } from '../../lib/scheduled-trip-registrations'
import { AdminScheduledTripRegistrationsTab } from '../../components/admin/AdminScheduledTripRegistrationsTab'
import {
  Modal, Labelled, ConfirmModal, FormButtons, CatalogPicker, ListingStatusBadge,
} from '../../components/admin/listing-ui'
import { FIELD, catalogLabel } from '../../components/admin/listing-fields'
import type {
  ScheduledTrip, ScheduledTripInsert, ScheduledTripStatus, EOAddon, EORoom,
} from '../../types/database'

// Admin catalog for Scheduled Trips — the shop's own curated, dated trips. Two
// tabs: Trips (CRUD, with catalog add-ons/rooms + the publish lifecycle) and
// Registrations (who registered). Divers register self-contained via the trip
// detail page (estimate + notify). Shares the modal/field/catalog-picker/status
// bits with the Packages admin via components/admin/listing-ui.

type Tab = 'trips' | 'registrations'

const PILL = 'px-3 py-1.5 rounded-lg text-sm font-semibold'

export function AdminScheduledTripsPage() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('trips')
  const [trips, setTrips] = useState<ScheduledTrip[]>([])
  const [newRegistrations, setNewRegistrations] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  async function reload() {
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
        const [t, n] = await Promise.all([fetchAllScheduledTrips(), countNewRegistrations()])
        if (cancelled) return
        setTrips(t)
        setNewRegistrations(n)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Scheduled Trips</h1>
      <p className="text-sm text-white/80">
        The shop's own dated trips shown on the diver Scheduled Trips tab. Give a trip
        catalog add-ons/rooms and divers register directly for a cost estimate.
      </p>

      <div className="flex gap-2" role="tablist" aria-label="Scheduled Trips sections">
        <TabButton active={tab === 'trips'} onClick={() => setTab('trips')}>Trips ({trips.length})</TabButton>
        <TabButton active={tab === 'registrations'} onClick={() => setTab('registrations')}>
          Registrations{newRegistrations > 0 && <span className="ml-1.5 inline-block bg-red-600 text-white rounded-full px-1.5 text-xs">{newRegistrations}</span>}
        </TabButton>
      </div>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">Loading…</p>
      ) : tab === 'registrations' ? (
        <AdminScheduledTripRegistrationsTab />
      ) : (
        <TripsTab
          trips={trips} onChanged={reload}
          onError={m => toast.error(m)} onOk={m => toast.success(m)}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={`${PILL} ${active ? 'bg-brand-600 text-white' : 'bg-white/70 text-brand-900 hover:bg-white/90'}`}>
      {children}
    </button>
  )
}

function TripsTab({ trips, onChanged, onError, onOk }: {
  trips: ScheduledTrip[]
  onChanged: () => Promise<void>
  onError: (m: string) => void
  onOk: (m: string) => void
}) {
  const [editing, setEditing] = useState<ScheduledTrip | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<ScheduledTrip | null>(null)

  async function changeStatus(trip: ScheduledTrip, status: ScheduledTripStatus) {
    try {
      await setScheduledTripStatus(trip, status)
      onOk(`Trip ${status}`)
      await onChanged()
    } catch (err) {
      onError(errorMessage(err))
    }
  }

  async function handleDelete(trip: ScheduledTrip) {
    try {
      await deleteScheduledTrip(trip.id)
      onOk('Trip deleted')
      setConfirmDelete(null)
      await onChanged()
    } catch (err) {
      onError(errorMessage(err))
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          + New trip
        </button>
      </div>

      {trips.length === 0 ? (
        <p className="text-sm text-white/70">No scheduled trips yet — add the shop's first one.</p>
      ) : (
        <ul className="space-y-2">
          {trips.map(trip => (
            <li key={trip.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-900 text-sm truncate">{trip.title}</p>
                  <p className="text-xs text-brand-900/80 truncate">{trip.destination}</p>
                </div>
                <ListingStatusBadge status={trip.status} />
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
          trip={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); onOk('Trip saved'); await onChanged() }}
          onError={onError}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete scheduled trip?"
          body={`"${confirmDelete.title}" and any registrations for it will be removed. To hide it but keep the record, archive it instead.`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function TripForm({ trip, onClose, onSaved, onError }: {
  trip: ScheduledTrip | null
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
  const [addonIds, setAddonIds] = useState<string[]>(trip?.addon_ids ?? [])
  const [roomIds, setRoomIds] = useState<string[]>(trip?.room_type_ids ?? [])
  const [status, setStatus] = useState<ScheduledTripStatus>(trip?.status ?? 'draft')
  const [allAddons, setAllAddons] = useState<EOAddon[]>([])
  const [allRooms, setAllRooms] = useState<EORoom[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [aRes, rRes] = await Promise.all([
          supabase.from('addons').select('*').order('admin_title'),
          supabase.from('rooms').select('*').order('admin_title'),
        ])
        if (cancelled) return
        setAllAddons((aRes.data ?? []) as EOAddon[])
        setAllRooms((rRes.data ?? []) as EORoom[])
      } catch (err) {
        if (!cancelled) onError(errorMessage(err))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])

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
        addon_ids: addonIds,
        room_type_ids: roomIds,
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

        <CatalogPicker label="Add-ons offered" items={allAddons.map(a => ({ id: a.id, label: catalogLabel(a) }))}
          selected={addonIds} onToggle={id => toggle(addonIds, setAddonIds, id)} empty="No add-ons in the catalog." />
        <CatalogPicker label="Room options offered" items={allRooms.map(r => ({ id: r.id, label: catalogLabel(r) }))}
          selected={roomIds} onToggle={id => toggle(roomIds, setRoomIds, id)} empty="No rooms in the catalog." />

        <Labelled label="Hero image URL"><input className={FIELD} value={heroImageUrl} onChange={e => setHeroImageUrl(e.target.value)} /></Labelled>
        <Labelled label="Highlights (one per line)">
          <textarea className={`${FIELD} resize-none`} rows={3} value={highlights} onChange={e => setHighlights(e.target.value)} />
        </Labelled>
        <Labelled label="Status">
          <select className={FIELD} value={status} onChange={e => setStatus(e.target.value as ScheduledTripStatus)} aria-label="Status">
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </Labelled>
        <FormButtons submitting={submitting} submitLabel={trip ? 'Save changes' : 'Create trip'} onClose={onClose} />
      </form>
    </Modal>
  )
}
