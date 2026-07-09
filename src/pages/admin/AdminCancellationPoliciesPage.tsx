import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import {
  fetchCancellationPolicies, saveCancellationPolicy, deleteCancellationPolicy,
  type CancellationPolicyInsert,
} from '../../lib/cancellation-policies'
import type { CancellationPolicy } from '../../types/database'
import { t } from '../../i18n'

const cp = t.admin.cxlPolicies
const wv = t.admin.waivers

// Admin catalog for the shop's cancellation policies. Each is free-form text in
// whatever language the shop needs; events point at one from the Edit-event
// form, and it's shown to the diver (to acknowledge) at registration.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminCancellationPoliciesPage() {
  const toast = useToast()
  const [policies, setPolicies] = useState<CancellationPolicy[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<CancellationPolicy | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<CancellationPolicy | null>(null)

  async function reload() {
    try {
      setPolicies(await fetchCancellationPolicies())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const p = await fetchCancellationPolicies()
        if (!cancelled) setPolicies(p)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleDelete(p: CancellationPolicy) {
    try {
      await deleteCancellationPolicy(p.id)
      toast.success(cp.deleted)
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{cp.title}</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {cp.newPolicy}
        </button>
      </div>
      <p className="text-sm text-white/80">
        {cp.intro}
      </p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">{wv.loading}</p>
      ) : policies.length === 0 ? (
        <p className="text-sm text-white/70">{cp.none}</p>
      ) : (
        <ul className="space-y-2">
          {policies.map(p => (
            <li key={p.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {p.title || cp.untitled}{!p.active && <span className="ml-2 text-xs text-brand-900/60">{wv.inactive}</span>}
                  {p.language ? <span className="ml-2 text-xs text-brand-900/60">{p.language}</span> : null}
                </p>
                <p className="text-xs text-brand-900/70 truncate">{p.cancellation_policy}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(p)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">{wv.edit}</button>
                <button type="button" onClick={() => setConfirmDelete(p)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">{wv.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <PolicyForm
          policy={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success(cp.saved); await reload() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={cp.deleteTitle}
          body={cp.deleteBody(confirmDelete.title || cp.thisPolicy)}
          confirmLabel={wv.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function PolicyForm({
  policy, onClose, onSaved, onError,
}: {
  policy: CancellationPolicy | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [title, setTitle] = useState(policy?.title ?? '')
  const [language, setLanguage] = useState(policy?.language ?? '')
  const [body, setBody] = useState(policy?.cancellation_policy ?? '')
  const [active, setActive] = useState(policy?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) { onError(wv.titleRequired); return }
    if (!body.trim()) { onError(cp.textRequired); return }
    setSubmitting(true)
    try {
      const values: CancellationPolicyInsert = {
        title: title.trim(),
        language: language.trim() || null,
        cancellation_policy: body.trim(),
        active,
      }
      await saveCancellationPolicy(values, policy?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="policy-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="policy-form-title" className="text-lg font-bold text-brand-900">{policy ? cp.editPolicy : cp.newPolicyTitle}</h2>
        <Labelled label={cp.titleLabel}>
          <input className={FIELD} value={title} onChange={e => setTitle(e.target.value)} placeholder={cp.titlePh} />
        </Labelled>
        <Labelled label={wv.languageLabel}>
          <input className={FIELD} value={language} onChange={e => setLanguage(e.target.value)} placeholder={wv.languagePh} />
        </Labelled>
        <Labelled label={cp.policyText}>
          <textarea className={`${FIELD} text-xs`} rows={8} value={body} onChange={e => setBody(e.target.value)}
            placeholder={cp.policyTextPh} />
        </Labelled>
        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          {cp.activeLabel}
        </label>
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
      role="dialog" aria-modal="true" aria-labelledby="policy-confirm-title" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 id="policy-confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
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
