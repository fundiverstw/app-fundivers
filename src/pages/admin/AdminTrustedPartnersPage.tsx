import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchAllTrustedPartners, saveTrustedPartner, deleteTrustedPartner } from '../../lib/trusted-partners'
import type { TrustedPartnerRow, TrustedPartnerInsert } from '../../types/database'

// Admin catalog for the shop's trusted partner dive shops abroad. These surface
// only on the diver-facing Trusted Partners tab, where a diver can message one;
// the partner's email lives here (admin-only) and never reaches the client.

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
      toast.success('Partner deleted')
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Trusted Partners</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          + New partner
        </button>
      </div>
      <p className="text-sm text-white/80">
        Dive shops abroad the shop vouches for. Divers see the name, region and
        blurb and can message a partner from the Trusted Partners tab; the email
        stays here and is never shown to divers. Retire a partner (untick Active)
        to hide it without deleting the record.
      </p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">Loading…</p>
      ) : partners.length === 0 ? (
        <p className="text-sm text-white/70">No partners yet — add the shop's first one.</p>
      ) : (
        <ul className="space-y-2">
          {partners.map(p => (
            <li key={p.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {p.name}{!p.active && <span className="ml-2 text-xs text-brand-900/60">(retired)</span>}
                </p>
                <p className="text-xs text-brand-900/80 truncate">
                  {[p.region, p.email].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(p)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">Edit</button>
                <button type="button" onClick={() => setConfirmDelete(p)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <PartnerForm
          partner={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success('Partner saved'); await reload() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete partner?"
          body={`"${confirmDelete.name}" will be removed. To keep it on record but hidden from divers, edit it and untick "Active" instead.`}
          confirmLabel="Delete"
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
  const [region, setRegion] = useState(partner?.region ?? '')
  const [blurb, setBlurb] = useState(partner?.blurb ?? '')
  const [email, setEmail] = useState(partner?.email ?? '')
  const [active, setActive] = useState(partner?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { onError('Name is required.'); return }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { onError('A valid partner email is required.'); return }
    setSubmitting(true)
    try {
      const values: TrustedPartnerInsert = {
        name: name.trim(),
        region: region.trim() || null,
        blurb: blurb.trim() || null,
        email: email.trim(),
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
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="partner-form-title" className="text-lg font-bold text-brand-900">{partner ? 'Edit partner' : 'New partner'}</h2>
        <Labelled label="Shop name *">
          <input className={FIELD} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Blue Manta Divers" />
        </Labelled>
        <Labelled label="Region">
          <input className={FIELD} value={region} onChange={e => setRegion(e.target.value)} placeholder="e.g. Anilao, Philippines" />
        </Labelled>
        <Labelled label="Blurb (shown to divers)">
          <textarea className={`${FIELD} resize-y`} rows={2} value={blurb} onChange={e => setBlurb(e.target.value)} placeholder="What makes them worth vouching for" />
        </Labelled>
        <Labelled label="Email * (never shown to divers)">
          <input className={FIELD} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="hello@partner.example" />
        </Labelled>
        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          Active (shown to divers)
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">Cancel</button>
          <button type="submit" disabled={submitting}
            className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
            {submitting ? 'Saving…' : 'Save'}
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
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">Cancel</button>
        <button type="button" onClick={onConfirm}
          className="text-sm font-semibold bg-red-700 hover:bg-red-800 text-white px-4 py-1.5 rounded-lg">{confirmLabel}</button>
      </div>
    </Modal>
  )
}
