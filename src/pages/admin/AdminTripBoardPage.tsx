import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import {
  fetchPartnerShops, savePartnerShop, deletePartnerShop,
  fetchTrips, saveTrip, setTripStatus, deleteTrip,
} from '../../lib/trip-admin'
import { countInterestedReferrals } from '../../lib/trip-referrals'
import { AdminReferralsTab } from '../../components/admin/AdminReferralsTab'
import type {
  PartnerShop, PartnerShopInsert, Trip, TripInsert, TripStatus,
} from '../../types/database'
import { BTN_SECONDARY } from '../../styles/tokens'

// Admin home for the Trip Board referral network. Two tabs:
//   - Shops: the registry of partner dive shops we vouch for (+ default
//     kickback rate, internal contact for brokering intros).
//   - Trips: the curated trips published to divers, with the publish lifecycle
//     (draft → published → archived) and a per-trip kickback rate.
// The Referrals pipeline (diver interest + kickback ledger) is a third tab
// added in a later phase.

type Tab = 'shops' | 'trips' | 'referrals'

const PILL = 'px-3 py-1.5 rounded-lg text-sm font-semibold'
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminTripBoardPage() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('trips')
  const [shops, setShops] = useState<PartnerShop[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [newInterest, setNewInterest] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Post-mutation refresh, called from the tab handlers; re-populates both
  // lists without the full-screen spinner.
  async function reload() {
    try {
      const [s, t] = await Promise.all([fetchPartnerShops(), fetchTrips()])
      setShops(s)
      setTrips(t)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [s, t, n] = await Promise.all([fetchPartnerShops(), fetchTrips(), countInterestedReferrals()])
        if (cancelled) return
        setShops(s)
        setTrips(t)
        setNewInterest(n)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const shopName = (id: string) => shops.find(s => s.id === id)?.name ?? '(unknown shop)'

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Trip Board</h1>

      <div className="flex gap-2" role="tablist" aria-label="Trip Board sections">
        <TabButton active={tab === 'trips'} onClick={() => setTab('trips')}>Trips ({trips.length})</TabButton>
        <TabButton active={tab === 'shops'} onClick={() => setTab('shops')}>Partner shops ({shops.length})</TabButton>
        <TabButton active={tab === 'referrals'} onClick={() => setTab('referrals')}>
          Referrals{newInterest > 0 && <span className="ml-1.5 inline-block bg-red-600 text-white rounded-full px-1.5 text-xs">{newInterest} new</span>}
        </TabButton>
      </div>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">Loading…</p>
      ) : tab === 'shops' ? (
        <ShopsTab shops={shops} onChanged={reload} onError={m => toast.error(m)} onOk={m => toast.success(m)} />
      ) : tab === 'referrals' ? (
        <AdminReferralsTab trips={trips} />
      ) : (
        <TripsTab
          trips={trips} shops={shops} shopName={shopName}
          onChanged={reload} onError={m => toast.error(m)} onOk={m => toast.success(m)}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`${PILL} ${active ? 'bg-brand-600 text-white' : 'bg-white/70 text-brand-900 hover:bg-white/90'}`}
    >
      {children}
    </button>
  )
}

// ============================================================
// Shops
// ============================================================

function ShopsTab({
  shops, onChanged, onError, onOk,
}: {
  shops: PartnerShop[]
  onChanged: () => Promise<void>
  onError: (m: string) => void
  onOk: (m: string) => void
}) {
  const [editing, setEditing] = useState<PartnerShop | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PartnerShop | null>(null)

  async function handleDelete(shop: PartnerShop) {
    try {
      await deletePartnerShop(shop.id)
      onOk('Partner shop deleted')
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
          + New partner shop
        </button>
      </div>

      {shops.length === 0 ? (
        <p className="text-sm text-white/70">No partner shops yet.</p>
      ) : (
        <ul className="space-y-2">
          {shops.map(shop => (
            <li key={shop.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {shop.name}{!shop.active && <span className="ml-2 text-xs text-brand-900/60">(inactive)</span>}
                </p>
                <p className="text-xs text-brand-900/80 truncate">
                  {[shop.location, shop.country].filter(Boolean).join(', ')} · {(shop.default_kickback_rate * 100).toFixed(1)}% default
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(shop)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">Edit</button>
                <button type="button" onClick={() => setConfirmDelete(shop)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <ShopForm
          shop={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); onOk('Partner shop saved'); await onChanged() }}
          onError={onError}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete partner shop?"
          body={`"${confirmDelete.name}" will be removed. Trips that reference it must be deleted first.`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function ShopForm({
  shop, onClose, onSaved, onError,
}: {
  shop: PartnerShop | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [name, setName] = useState(shop?.name ?? '')
  const [country, setCountry] = useState(shop?.country ?? '')
  const [location, setLocation] = useState(shop?.location ?? '')
  const [website, setWebsite] = useState(shop?.website ?? '')
  const [contactName, setContactName] = useState(shop?.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(shop?.contact_email ?? '')
  const [logoUrl, setLogoUrl] = useState(shop?.logo_url ?? '')
  const [vouchNotes, setVouchNotes] = useState(shop?.vouch_notes ?? '')
  const [rate, setRate] = useState(((shop?.default_kickback_rate ?? 0.05) * 100).toString())
  const [active, setActive] = useState(shop?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !country.trim()) { onError('Name and country are required.'); return }
    setSubmitting(true)
    try {
      const values: PartnerShopInsert = {
        name: name.trim(),
        country: country.trim(),
        location: location.trim() || null,
        website: website.trim() || null,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        logo_url: logoUrl.trim() || null,
        vouch_notes: vouchNotes.trim() || null,
        default_kickback_rate: Number(rate) / 100,
        active,
      }
      await savePartnerShop(values, shop?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="shop-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="shop-form-title" className="text-lg font-bold text-brand-900">{shop ? 'Edit partner shop' : 'New partner shop'}</h2>
        <Labelled label="Name *"><input className={FIELD} value={name} onChange={e => setName(e.target.value)} /></Labelled>
        <Labelled label="Country *"><input className={FIELD} value={country} onChange={e => setCountry(e.target.value)} /></Labelled>
        <Labelled label="Location"><input className={FIELD} value={location} onChange={e => setLocation(e.target.value)} placeholder="City / region" /></Labelled>
        <Labelled label="Website"><input className={FIELD} value={website} onChange={e => setWebsite(e.target.value)} /></Labelled>
        <Labelled label="Logo URL"><input className={FIELD} value={logoUrl} onChange={e => setLogoUrl(e.target.value)} /></Labelled>
        <Labelled label="Why we vouch (shown to divers)">
          <textarea className={`${FIELD} resize-none`} rows={2} value={vouchNotes} onChange={e => setVouchNotes(e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Contact name (internal)"><input className={FIELD} value={contactName} onChange={e => setContactName(e.target.value)} /></Labelled>
          <Labelled label="Contact email (internal)"><input className={FIELD} value={contactEmail} onChange={e => setContactEmail(e.target.value)} /></Labelled>
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <Labelled label="Default kickback %">
            <input className={FIELD} type="number" step="any" value={rate} onChange={e => setRate(e.target.value)} />
          </Labelled>
          <label className="flex items-center gap-2 text-sm text-brand-900 pb-2">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Active
          </label>
        </div>
        <FormButtons submitting={submitting} submitLabel={shop ? 'Save changes' : 'Create shop'} onClose={onClose} />
      </form>
    </Modal>
  )
}

// ============================================================
// Trips
// ============================================================

function TripsTab({
  trips, shops, shopName, onChanged, onError, onOk,
}: {
  trips: Trip[]
  shops: PartnerShop[]
  shopName: (id: string) => string
  onChanged: () => Promise<void>
  onError: (m: string) => void
  onOk: (m: string) => void
}) {
  const [editing, setEditing] = useState<Trip | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Trip | null>(null)

  async function changeStatus(trip: Trip, status: TripStatus) {
    try {
      await setTripStatus(trip, status)
      onOk(`Trip ${status}`)
      await onChanged()
    } catch (err) {
      onError(errorMessage(err))
    }
  }

  async function handleDelete(trip: Trip) {
    try {
      await deleteTrip(trip.id)
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
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={shops.length === 0}
          title={shops.length === 0 ? 'Add a partner shop first' : undefined}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
        >
          + New trip
        </button>
      </div>

      {shops.length === 0 && (
        <p className="text-sm text-white/70">Add a partner shop before creating a trip.</p>
      )}

      {trips.length === 0 ? (
        <p className="text-sm text-white/70">No trips yet.</p>
      ) : (
        <ul className="space-y-2">
          {trips.map(trip => (
            <li key={trip.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-900 text-sm truncate">{trip.title}</p>
                  <p className="text-xs text-brand-900/80 truncate">
                    {trip.destination} · {shopName(trip.partner_shop_id)} · {(trip.kickback_rate * 100).toFixed(1)}%
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
          trip={editing} shops={shops}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); onOk('Trip saved'); await onChanged() }}
          onError={onError}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete trip?"
          body={`"${confirmDelete.title}" and any referrals for it will be permanently deleted.`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: TripStatus }) {
  const cls = status === 'published'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : status === 'draft'
      ? 'bg-amber-100 text-amber-800 border-amber-300'
      : 'bg-slate-100 text-slate-700 border-slate-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>{status}</span>
}

function TripForm({
  trip, shops, onClose, onSaved, onError,
}: {
  trip: Trip | null
  shops: PartnerShop[]
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [partnerId, setPartnerId] = useState(trip?.partner_shop_id ?? shops[0]?.id ?? '')
  const [title, setTitle] = useState(trip?.title ?? '')
  const [destination, setDestination] = useState(trip?.destination ?? '')
  const [summary, setSummary] = useState(trip?.summary ?? '')
  const [description, setDescription] = useState(trip?.description ?? '')
  const [startDate, setStartDate] = useState(trip?.start_date ?? '')
  const [endDate, setEndDate] = useState(trip?.end_date ?? '')
  const [price, setPrice] = useState(trip?.price?.toString() ?? '')
  const [currency, setCurrency] = useState(trip?.currency ?? siteConfig.locale.currency)
  const [heroImageUrl, setHeroImageUrl] = useState(trip?.hero_image_url ?? '')
  const [bookingUrl, setBookingUrl] = useState(trip?.booking_url ?? '')
  const [highlights, setHighlights] = useState((trip?.highlights ?? []).join('\n'))
  const selectedShop = shops.find(s => s.id === partnerId)
  const [rate, setRate] = useState((((trip?.kickback_rate ?? selectedShop?.default_kickback_rate ?? 0.05)) * 100).toString())
  const [status, setStatus] = useState<TripStatus>(trip?.status ?? 'draft')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!partnerId) { onError('Pick a partner shop.'); return }
    if (!title.trim() || !destination.trim()) { onError('Title and destination are required.'); return }
    if (startDate && endDate && endDate < startDate) { onError('End date is before the start date.'); return }
    setSubmitting(true)
    try {
      const values: TripInsert = {
        partner_shop_id: partnerId,
        title: title.trim(),
        destination: destination.trim(),
        summary: summary.trim() || null,
        description: description.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        price: price.trim() === '' ? null : Number(price),
        currency: currency.trim() || siteConfig.locale.currency,
        hero_image_url: heroImageUrl.trim() || null,
        booking_url: bookingUrl.trim() || null,
        highlights: highlights.split('\n').map(h => h.trim()).filter(Boolean),
        kickback_rate: Number(rate) / 100,
        status,
      }
      await saveTrip(values, trip ?? undefined)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="trip-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3 max-h-[80vh] overflow-y-auto">
        <h2 id="trip-form-title" className="text-lg font-bold text-brand-900">{trip ? 'Edit trip' : 'New trip'}</h2>
        <Labelled label="Partner shop *">
          <select className={FIELD} value={partnerId} onChange={e => setPartnerId(e.target.value)} aria-label="Partner shop">
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Labelled>
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
        <Labelled label="Booking URL (partner site)"><input className={FIELD} value={bookingUrl} onChange={e => setBookingUrl(e.target.value)} /></Labelled>
        <Labelled label="Highlights (one per line)">
          <textarea className={`${FIELD} resize-none`} rows={3} value={highlights} onChange={e => setHighlights(e.target.value)} />
        </Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Kickback %"><input className={FIELD} type="number" step="any" value={rate} onChange={e => setRate(e.target.value)} /></Labelled>
          <Labelled label="Status">
            <select className={FIELD} value={status} onChange={e => setStatus(e.target.value as TripStatus)} aria-label="Status">
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </Labelled>
        </div>
        <FormButtons submitting={submitting} submitLabel={trip ? 'Save changes' : 'Create trip'} onClose={onClose} />
      </form>
    </Modal>
  )
}

// ============================================================
// Shared bits
// ============================================================

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-brand-900">{label}</span>
      {children}
    </label>
  )
}

function FormButtons({ submitting, submitLabel, onClose }: { submitting: boolean; submitLabel: string; onClose: () => void }) {
  return (
    <div className="flex gap-2 pt-1">
      <button type="button" onClick={onClose} disabled={submitting}
        className={`flex-1 ${BTN_SECONDARY}`}>Cancel</button>
      <button type="submit" disabled={submitting}
        className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50">
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </div>
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
