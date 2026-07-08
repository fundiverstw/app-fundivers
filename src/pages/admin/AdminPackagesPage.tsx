import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { siteConfig } from '../../config/site'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { supabase } from '../../lib/supabase'
import {
  fetchPackages, fetchPackageTiers, savePackage, setPackageStatus, deletePackage, type TierDraft,
} from '../../lib/package-admin'
import { fetchAllTrustedPartners } from '../../lib/trusted-partners'
import { countNewRegistrations } from '../../lib/package-registrations'
import { AdminRegistrationsTab } from '../../components/admin/AdminRegistrationsTab'
import {
  Modal, Labelled, ConfirmModal, FormButtons, CatalogPicker, ListingStatusBadge,
} from '../../components/admin/listing-ui'
import { FIELD, catalogLabel } from '../../components/admin/listing-fields'
import type {
  TrustedPartnerRow, Package, PackageInsert, PackageStatus, PackageTier, EOAddon, EORoom,
} from '../../types/database'

// Admin home for Packages — the partner-shop registration network. Two tabs:
//   - Packages: the products published to divers, each with price tiers,
//     catalog add-ons/rooms, a kickback rate, and the draft→published→archived
//     lifecycle.
//   - Registrations: who registered (the Manage roster) + the kickback ledger.
// The hosting shops are trusted partners — managed on the Trusted Partners
// admin page; here they're just picked from a dropdown when creating a package.
// The modal / field / catalog-picker / status-badge bits are shared with the
// Scheduled Trips admin via components/admin/listing-ui.

type Tab = 'packages' | 'registrations'

const PILL = 'px-3 py-1.5 rounded-lg text-sm font-semibold'

export function AdminPackagesPage() {
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('packages')
  const [partners, setPartners] = useState<TrustedPartnerRow[]>([])
  const [packages, setPackages] = useState<Package[]>([])
  const [newRegistrations, setNewRegistrations] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

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
        const [tp, p, n] = await Promise.all([fetchAllTrustedPartners(), fetchPackages(), countNewRegistrations()])
        if (cancelled) return
        setPartners(tp)
        setPackages(p)
        setNewRegistrations(n)
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
        <AdminRegistrationsTab />
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
                <ListingStatusBadge status={pkg.status} />
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
          body={`"${confirmDelete.title}", its tiers and any registrations for it will be permanently deleted.`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
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
  const [currency, setCurrency] = useState(pkg?.currency ?? siteConfig.locale.currency)
  const [heroImageUrl, setHeroImageUrl] = useState(pkg?.hero_image_url ?? '')
  const [highlights, setHighlights] = useState((pkg?.highlights ?? []).join('\n'))
  const selectedPartner = partners.find(p => p.id === partnerId)
  const [rate, setRate] = useState((((pkg?.kickback_rate ?? selectedPartner?.default_kickback_rate ?? 0.05)) * 100).toString())
  const [status, setStatus] = useState<PackageStatus>(pkg?.status ?? 'draft')
  const [addonIds, setAddonIds] = useState<string[]>(pkg?.addon_ids ?? [])
  const [roomIds, setRoomIds] = useState<string[]>(pkg?.room_type_ids ?? [])
  const [tiers, setTiers] = useState<TierDraft[]>([{ name: '', price: 0 }])
  const [tierPrices, setTierPrices] = useState<string[]>([''])

  const [allAddons, setAllAddons] = useState<EOAddon[]>([])
  const [allRooms, setAllRooms] = useState<EORoom[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Load the catalog for the selectors, and (editing) the package's tiers.
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
        if (pkg) {
          const existing: PackageTier[] = await fetchPackageTiers(pkg.id)
          if (cancelled) return
          if (existing.length) {
            setTiers(existing.map(t => ({ id: t.id, name: t.name, price: t.price })))
            setTierPrices(existing.map(t => t.price.toString()))
          }
        }
      } catch (err) {
        if (!cancelled) onError(errorMessage(err))
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg])

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])

  const setTierName = (i: number, name: string) =>
    setTiers(ts => ts.map((t, j) => (j === i ? { ...t, name } : t)))
  const setTierPrice = (i: number, priceStr: string) => {
    setTierPrices(ps => ps.map((p, j) => (j === i ? priceStr : p)))
    setTiers(ts => ts.map((t, j) => (j === i ? { ...t, price: Number(priceStr) || 0 } : t)))
  }
  const addTier = () => { setTiers(ts => [...ts, { name: '', price: 0 }]); setTierPrices(ps => [...ps, '']) }
  const removeTier = (i: number) => {
    setTiers(ts => ts.filter((_, j) => j !== i))
    setTierPrices(ps => ps.filter((_, j) => j !== i))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!partnerId) { onError('Pick a trusted partner.'); return }
    if (!title.trim() || !destination.trim()) { onError('Title and destination are required.'); return }
    const cleanTiers = tiers
      .map((t, i) => ({ ...t, name: t.name.trim(), price: Number(tierPrices[i]) || 0 }))
      .filter(t => t.name)
    if (cleanTiers.length === 0) { onError('Add at least one package tier with a name.'); return }
    if (cleanTiers.some(t => !(t.price >= 0))) { onError('Every tier needs a price.'); return }
    setSubmitting(true)
    try {
      const values: PackageInsert = {
        trusted_partner_id: partnerId,
        title: title.trim(),
        destination: destination.trim(),
        summary: summary.trim() || null,
        description: description.trim() || null,
        currency: currency.trim() || siteConfig.locale.currency,
        hero_image_url: heroImageUrl.trim() || null,
        highlights: highlights.split('\n').map(h => h.trim()).filter(Boolean),
        addon_ids: addonIds,
        room_type_ids: roomIds,
        kickback_rate: Number(rate) / 100,
        status,
      }
      await savePackage(values, cleanTiers, pkg ?? undefined)
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

        {/* Price tiers (Package A/B/C) */}
        <fieldset className="space-y-2 border border-surface-300 rounded-md p-2">
          <legend className="text-xs font-semibold text-brand-900 px-1">Packages / price tiers *</legend>
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={FIELD} placeholder={`Package ${String.fromCharCode(65 + i)}`} value={t.name}
                onChange={e => setTierName(i, e.target.value)} aria-label={`Tier ${i + 1} name`} />
              <input className={`${FIELD} w-28`} type="number" step="any" min="0" placeholder="Price" value={tierPrices[i] ?? ''}
                onChange={e => setTierPrice(i, e.target.value)} aria-label={`Tier ${i + 1} price`} />
              {tiers.length > 1 && (
                <button type="button" onClick={() => removeTier(i)} aria-label={`Remove tier ${i + 1}`}
                  className="text-red-700 hover:text-red-900 text-lg leading-none px-1">×</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addTier} className="text-xs font-semibold text-brand-900 underline">+ Add tier</button>
        </fieldset>

        <Labelled label="Currency"><input className={FIELD} value={currency} onChange={e => setCurrency(e.target.value)} /></Labelled>

        {/* Catalog add-ons/rooms available to registrants */}
        <CatalogPicker label="Add-ons offered" items={allAddons.map(a => ({ id: a.id, label: catalogLabel(a) }))}
          selected={addonIds} onToggle={id => toggle(addonIds, setAddonIds, id)} empty="No add-ons in the catalog." />
        <CatalogPicker label="Room options offered" items={allRooms.map(r => ({ id: r.id, label: catalogLabel(r) }))}
          selected={roomIds} onToggle={id => toggle(roomIds, setRoomIds, id)} empty="No rooms in the catalog." />

        <Labelled label="Hero image URL"><input className={FIELD} value={heroImageUrl} onChange={e => setHeroImageUrl(e.target.value)} /></Labelled>
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

