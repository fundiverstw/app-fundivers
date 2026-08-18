import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchDiveSites, saveDiveSite, deleteDiveSite, type DiveSiteInsert } from '../../lib/dive-sites'
import { SITE_KINDS, type DiveSite, type SiteKind } from '../../types/database'
import { EVENT_KIND_LABELS } from '../../lib/event-kind-labels'
import { t } from '../../i18n'

const ds = t.admin.diveSites
const wv = t.admin.waivers

// The shop's places, in one list. Events say which one they go to and the
// almanac files conditions against them, so a site named once here is the same
// site everywhere — the reason this is a catalog and not a free-text field.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminDiveSitesPage() {
  const toast = useToast()
  const [sites, setSites] = useState<DiveSite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<DiveSite | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<DiveSite | null>(null)

  async function reload() {
    try {
      setSites(await fetchDiveSites())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchDiveSites()
        if (!cancelled) setSites(rows)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleDelete(site: DiveSite) {
    try {
      await deleteDiveSite(site.id)
      toast.success(ds.deleted)
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{ds.title}</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {ds.newSite}
        </button>
      </div>
      <p className="text-sm text-white/80">{ds.intro}</p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">{wv.loading}</p>
      ) : sites.length === 0 ? (
        <p className="text-sm text-white/70">{ds.none}</p>
      ) : (
        <ul className="space-y-2">
          {sites.map(site => (
            <li key={site.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {site.name}
                  <span className="ml-2 text-xs text-brand-900/60">{EVENT_KIND_LABELS[site.kind]}</span>
                  {!site.active && <span className="ml-2 text-xs text-brand-900/60">{wv.inactive}</span>}
                </p>
                <p className="text-xs text-brand-900/70 truncate">
                  {[site.region, site.notes].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(site)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">{wv.edit}</button>
                <button type="button" onClick={() => setConfirmDelete(site)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">{wv.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <SiteForm
          site={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success(ds.saved); await reload() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={ds.deleteTitle}
          body={ds.deleteBody(confirmDelete.name)}
          confirmLabel={wv.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function SiteForm({
  site, onClose, onSaved, onError,
}: {
  site: DiveSite | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [name, setName] = useState(site?.name ?? '')
  const [kind, setKind] = useState<SiteKind>(site?.kind ?? SITE_KINDS[0])
  const [region, setRegion] = useState(site?.region ?? '')
  const [notes, setNotes] = useState(site?.notes ?? '')
  const [active, setActive] = useState(site?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) { onError(ds.nameRequired); return }
    setSubmitting(true)
    try {
      const values: DiveSiteInsert = {
        name: name.trim(),
        kind,
        region: region.trim() || null,
        notes: notes.trim() || null,
        active,
      }
      await saveDiveSite(values, site?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="site-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="site-form-title" className="text-lg font-bold text-brand-900">{site ? ds.editSite : ds.newSiteTitle}</h2>
        <Labelled label={ds.nameLabel}>
          <input className={FIELD} value={name} onChange={e => setName(e.target.value)} placeholder={ds.namePh} />
        </Labelled>
        <Labelled label={ds.kindLabel}>
          <select className={FIELD} value={kind} onChange={e => setKind(e.target.value as SiteKind)}>
            {SITE_KINDS.map(k => (
              <option key={k} value={k}>{EVENT_KIND_LABELS[k]}</option>
            ))}
          </select>
        </Labelled>
        <Labelled label={ds.regionLabel}>
          <input className={FIELD} value={region} onChange={e => setRegion(e.target.value)} placeholder={ds.regionPh} />
        </Labelled>
        <Labelled label={ds.notesLabel}>
          <textarea className={`${FIELD} text-xs`} rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder={ds.notesPh} />
        </Labelled>
        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          {ds.activeLabel}
        </label>
        <p className="text-xs text-brand-900/70">{ds.retireHint}</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">{wv.cancel}</button>
          <button type="submit" disabled={submitting}
            className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
            {submitting ? wv.saving : wv.save}
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
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby="site-confirm-title" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 id="site-confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
        <p className="text-sm text-brand-900/80">{body}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">{wv.cancel}</button>
          <button type="button" onClick={onConfirm}
            className="text-sm font-semibold bg-red-700 hover:bg-red-800 text-white px-4 py-1.5 rounded-lg">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
