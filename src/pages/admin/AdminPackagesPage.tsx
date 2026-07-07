import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import {
  fetchPackages, savePackage, setPackageStatus, deletePackage,
} from '../../lib/package-admin'
import { fetchAllTrustedPartners } from '../../lib/trusted-partners'
import { countInterestedReferrals } from '../../lib/package-referrals'
import { AdminReferralsTab } from '../../components/admin/AdminReferralsTab'
import type {
  TrustedPartnerRow, Package, PackageInsert, PackageStatus,
} from '../../types/database'
import { BTN_SECONDARY } from '../../styles/tokens'

// Admin home for Packages — the partner referral network (open-ended travel
// packages abroad). Two tabs:
//   - Packages: the curated packages published to divers, with the publish
//     lifecycle (draft → published → archived) and a per-package kickback rate.
//   - Referrals: the diver-interest pipeline + kickback ledger.
// The hosting shops are trusted partners — managed on the Trusted Partners
// admin page; here they're just picked from a dropdown when creating a package.

type Tab = 'packages' | 'referrals'

const PILL = 'px-3 py-1.5 rounded-lg text-sm font-semibold'
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminPackagesPage() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('packages')
  const [partners, setPartners] = useState<TrustedPartnerRow[]>([])
  const [packages, setPackages] = useState<Package[]>([])
  const [newInterest, setNewInterest] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Post-mutation refresh, called from the tab handlers; re-populates the
  // partner + package lists without the full-screen spinner.
  async function reload() {
    try {
      const [tp, p] = await Promise.all([fetchAllTrustedPartners(), fetchPackages()])
      setPartners(tp)
      setPackages(p)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [tp, p, n] = await Promise.all([fetchAllTrustedPartners(), fetchPackages(), countInterestedReferrals()])
        if (cancelled) return
        setPartners(tp)
        setPackages(p)
        setNewInterest(n)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const partnerName = (id: string) => partners.find(p => p.id === id)?.name ?? '(unknown partner)'

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-white">Packages</h1>

      <div className="flex gap-2" role="tablist" aria-label="Packages sections">
        <TabButton active={tab === 'packages'} onClick={() => setTab('packages')}>Packages ({packages.length})</TabButton>
        <TabButton active={tab === 'referrals'} onClick={() => setTab('referrals')}>
          Referrals{newInterest > 0 && <span className="ml-1.5 inline-block bg-red-600 text-white rounded-full px-1.5 text-xs">{newInterest} new</span>}
        </TabButton>
      </div>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">Loading…</p>
      ) : tab === 'referrals' ? (
        <AdminReferralsTab packages={packages} />
      ) : (
        <PackagesTab
          packages={packages} partners={partners} partnerName={partnerName}
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
// Packages
// ============================================================

function PackagesTab({
  packages, partners, partnerName, onChanged, onError, onOk,
}: {
  packages: Package[]
  partners: TrustedPartnerRow[]
  partnerName: (id: string) => string
  onChanged: () => Promise<void>
  onError: (m: string) => void
  onOk: (m: string) => void
}) {
  const [editing, setEditing] = useState<Package | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Package | null>(null)

  async function changeStatus(pkg: Package, status: PackageStatus) {
    try {
      await setPackageStatus(pkg, status)
      onOk(`Package ${status}`)
      await onChanged()
    } catch (err) {
      onError(errorMessage(err))
    }
  }

  async function handleDelete(pkg: Package) {
    try {
      await deletePackage(pkg.id)
      onOk('Package deleted')
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
          disabled={partners.length === 0}
          title={partners.length === 0 ? 'Add a trusted partner first' : undefined}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
        >
          + New package
        </button>
      </div>

      {partners.length === 0 && (
        <p className="text-sm text-white/70">
          Add a <Link to="/admin/trusted-partners" className="underline">trusted partner</Link> before creating a package.
        </p>
      )}

      {packages.length === 0 ? (
        <p className="text-sm text-white/70">No packages yet.</p>
      ) : (
        <ul className="space-y-2">
          {packages.map(pkg => (
            <li key={pkg.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-brand-900 text-sm truncate">{pkg.title}</p>
                  <p className="text-xs text-brand-900/80 truncate">
                    {pkg.destination} · {partnerName(pkg.trusted_partner_id)} · {(pkg.kickback_rate * 100).toFixed(1)}%
                  </p>
                </div>
                <StatusBadge status={pkg.status} />
              </div>
              <div className="flex flex-wrap gap-2">
                {pkg.status !== 'published' && (
                  <button type="button" onClick={() => changeStatus(pkg, 'published')}
                    className="text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white px-2.5 py-1 rounded-lg">Publish</button>
                )}
                {pkg.status === 'published' && (
                  <button type="button" onClick={() => changeStatus(pkg, 'draft')}
                    className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-2.5 py-1 rounded-lg">Unpublish</button>
                )}
                {pkg.status !== 'archived' && (
                  <button type="button" onClick={() => changeStatus(pkg, 'archived')}
                    className="text-xs font-semibold bg-slate-600 hover:bg-slate-700 text-white px-2.5 py-1 rounded-lg">Archive</button>
                )}
                <button type="button" onClick={() => setEditing(pkg)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-2.5 py-1 rounded-lg">Edit</button>
                <button type="button" onClick={() => setConfirmDelete(pkg)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-2.5 py-1 rounded-lg">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <PackageForm
          pkg={editing} partners={partners}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); onOk('Package saved'); await onChanged() }}
          onError={onError}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete package?"
          body={`"${confirmDelete.title}" and any referrals for it will be permanently deleted.`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: PackageStatus }) {
  const cls = status === 'published'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : status === 'draft'
      ? 'bg-amber-100 text-amber-800 border-amber-300'
      : 'bg-slate-100 text-slate-700 border-slate-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>{status}</span>
}

function PackageForm({
  pkg, partners, onClose, onSaved, onError,
}: {
  pkg: Package | null
  partners: TrustedPartnerRow[]
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [partnerId, setPartnerId] = useState(pkg?.trusted_partner_id ?? partners[0]?.id ?? '')
  const [title, setTitle] = useState(pkg?.title ?? '')
  const [destination, setDestination] = useState(pkg?.destination ?? '')
  const [summary, setSummary] = useState(pkg?.summary ?? '')
  const [description, setDescription] = useState(pkg?.description ?? '')
  const [startDate, setStartDate] = useState(pkg?.start_date ?? '')
  const [endDate, setEndDate] = useState(pkg?.end_date ?? '')
  const [price, setPrice] = useState(pkg?.price?.toString() ?? '')
  const [currency, setCurrency] = useState(pkg?.currency ?? siteConfig.locale.currency)
  const [heroImageUrl, setHeroImageUrl] = useState(pkg?.hero_image_url ?? '')
  const [bookingUrl, setBookingUrl] = useState(pkg?.booking_url ?? '')
  const [highlights, setHighlights] = useState((pkg?.highlights ?? []).join('\n'))
  const selectedPartner = partners.find(p => p.id === partnerId)
  const [rate, setRate] = useState((((pkg?.kickback_rate ?? selectedPartner?.default_kickback_rate ?? 0.05)) * 100).toString())
  const [status, setStatus] = useState<PackageStatus>(pkg?.status ?? 'draft')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!partnerId) { onError('Pick a trusted partner.'); return }
    if (!title.trim() || !destination.trim()) { onError('Title and destination are required.'); return }
    if (startDate && endDate && endDate < startDate) { onError('End date is before the start date.'); return }
    setSubmitting(true)
    try {
      const values: PackageInsert = {
        trusted_partner_id: partnerId,
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
      await savePackage(values, pkg ?? undefined)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="package-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3 max-h-[80vh] overflow-y-auto">
        <h2 id="package-form-title" className="text-lg font-bold text-brand-900">{pkg ? 'Edit package' : 'New package'}</h2>
        <Labelled label="Trusted partner *">
          <select className={FIELD} value={partnerId} onChange={e => setPartnerId(e.target.value)} aria-label="Trusted partner">
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
            <select className={FIELD} value={status} onChange={e => setStatus(e.target.value as PackageStatus)} aria-label="Status">
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </Labelled>
        </div>
        <FormButtons submitting={submitting} submitLabel={pkg ? 'Save changes' : 'Create package'} onClose={onClose} />
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
