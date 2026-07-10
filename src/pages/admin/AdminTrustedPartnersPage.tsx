import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchAllTrustedPartners, saveTrustedPartner, deleteTrustedPartner } from '../../lib/trusted-partners'
import type { TrustedPartnerRow, TrustedPartnerInsert } from '../../types/database'
import { t } from '../../i18n'

const pt = t.admin.partners
const w = t.admin.waivers

// Admin catalog for trusted partners — the single "dive shops abroad we vouch
// for" table (20260707220000). One record does double duty: it powers the
// diver-facing Trusted Partners tab (name / region / blurb / website, plus a
// contact email divers message through the edge function) AND it hosts Packages
// (country / location / logo / default kickback / internal contact). The contact
// email is admin-only and never reaches the client.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminTrustedPartnersPage() {
  const toast = useToast()
  const [partners, setPartners] = useState<TrustedPartnerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<TrustedPartnerRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<TrustedPartnerRow | null>(null)

  async function reload() {
    try {
      setPartners(await fetchAllTrustedPartners())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const p = await fetchAllTrustedPartners()
        if (!cancelled) setPartners(p)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleDelete(p: TrustedPartnerRow) {
    try {
      await deleteTrustedPartner(p.id)
      toast.success(pt.deleted)
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{t.partners.title}</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {pt.newPartner}
        </button>
      </div>
      <p className="text-sm text-white/80">{pt.intro}</p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">{w.loading}</p>
      ) : partners.length === 0 ? (
        <p className="text-sm text-white/70">{pt.none}</p>
      ) : (
        <ul className="space-y-2">
          {partners.map(p => (
            <li key={p.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {p.name}{!p.active && <span className="ml-2 text-xs text-brand-900/60">{pt.retired}</span>}
                </p>
                <p className="text-xs text-brand-900/80 truncate">
                  {[p.location ?? p.country, p.contact_email].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(p)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">{w.edit}</button>
                <button type="button" onClick={() => setConfirmDelete(p)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">{w.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <PartnerForm
          partner={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success(pt.saved); await reload() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={pt.deleteTitle}
          body={pt.deleteBody(confirmDelete.name)}
          confirmLabel={w.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function PartnerForm({
  partner, onClose, onSaved, onError,
}: {
  partner: TrustedPartnerRow | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [name, setName] = useState(partner?.name ?? '')
  const [country, setCountry] = useState(partner?.country ?? '')
  const [location, setLocation] = useState(partner?.location ?? '')
  const [website, setWebsite] = useState(partner?.website ?? '')
  const [blurb, setBlurb] = useState(partner?.vouch_notes ?? '')
  const [logoUrl, setLogoUrl] = useState(partner?.logo_url ?? '')
  const [contactName, setContactName] = useState(partner?.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(partner?.contact_email ?? '')
  const [rate, setRate] = useState(((partner?.default_kickback_rate ?? 0.05) * 100).toString())
  const [active, setActive] = useState(partner?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { onError(pt.nameRequired); return }
    // Email is optional (a package-only partner may not have one), but if given
    // it must be valid — it's how divers reach the partner from the directory.
    if (contactEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.trim())) {
      onError(pt.emailInvalid); return
    }
    setSubmitting(true)
    try {
      const values: TrustedPartnerInsert = {
        name: name.trim(),
        country: country.trim() || null,
        location: location.trim() || null,
        website: website.trim() || null,
        vouch_notes: blurb.trim() || null,
        logo_url: logoUrl.trim() || null,
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        default_kickback_rate: Number(rate) / 100,
        active,
      }
      await saveTrustedPartner(values, partner?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="partner-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3 max-h-[80vh] overflow-y-auto">
        <h2 id="partner-form-title" className="text-lg font-bold text-brand-900">{partner ? pt.editPartner : pt.newPartnerTitle}</h2>
        <Labelled label={pt.shopName}>
          <input className={FIELD} value={name} onChange={e => setName(e.target.value)} placeholder={pt.shopNamePh} />
        </Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label={pt.country}><input className={FIELD} value={country} onChange={e => setCountry(e.target.value)} placeholder={pt.countryPh} /></Labelled>
          <Labelled label={pt.location}><input className={FIELD} value={location} onChange={e => setLocation(e.target.value)} placeholder={pt.locationPh} /></Labelled>
        </div>
        <Labelled label={pt.website}>
          <input className={FIELD} type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://partner.example" />
        </Labelled>
        <Labelled label={pt.blurb}>
          <textarea className={`${FIELD} resize-y`} rows={2} value={blurb} onChange={e => setBlurb(e.target.value)} placeholder={pt.blurbPh} />
        </Labelled>
        <Labelled label={pt.logoUrl}><input className={FIELD} value={logoUrl} onChange={e => setLogoUrl(e.target.value)} /></Labelled>
        <div className="grid grid-cols-2 gap-2">
          <Labelled label={pt.contactName}><input className={FIELD} value={contactName} onChange={e => setContactName(e.target.value)} /></Labelled>
          <Labelled label={pt.contactEmail}>
            <input className={FIELD} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="hello@partner.example" />
          </Labelled>
        </div>
        <div className="grid grid-cols-2 gap-2 items-end">
          <Labelled label={pt.defaultKickback}>
            <input className={FIELD} type="number" step="any" value={rate} onChange={e => setRate(e.target.value)} />
          </Labelled>
          <label className="flex items-center gap-2 text-sm text-brand-900 pb-2">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
            {pt.activeLabel}
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">{w.cancel}</button>
          <button type="submit" disabled={submitting}
            className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
            {submitting ? w.saving : w.save}
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
    <Modal labelledBy="partner-confirm-title" onClose={onClose}>
      <h2 id="partner-confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
      <p className="text-sm text-brand-900/80">{body}</p>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">{w.cancel}</button>
        <button type="button" onClick={onConfirm}
          className="text-sm font-semibold bg-red-700 hover:bg-red-800 text-white px-4 py-1.5 rounded-lg">{confirmLabel}</button>
      </div>
    </Modal>
  )
}
