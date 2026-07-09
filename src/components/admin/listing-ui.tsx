import type { ReactNode } from 'react'
import { BTN_SECONDARY } from '../../styles/tokens'
import { t } from '../../i18n'

const c = t.admin.catalog

// Shared admin form/modal bits for the curated-listing editors (Packages,
// Scheduled Trips). Both admin pages render the same modal shell, labelled
// fields, catalog multi-selects, publish-lifecycle status badge, and
// confirm/delete dialog — extracted here so they live in one place.

export function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-brand-900">{label}</span>
      {children}
    </label>
  )
}

export function FormButtons({ submitting, submitLabel, onClose }: {
  submitting: boolean; submitLabel: string; onClose: () => void
}) {
  return (
    <div className="flex gap-2 pt-1">
      <button type="button" onClick={onClose} disabled={submitting} className={`flex-1 ${BTN_SECONDARY}`}>{c.cancel}</button>
      <button type="submit" disabled={submitting}
        className="flex-1 py-2 rounded-lg text-sm font-semibold bg-brand-900 hover:bg-brand-950 text-white disabled:opacity-50">
        {submitting ? c.saving : submitLabel}
      </button>
    </div>
  )
}

/** Multi-select of catalog items (add-ons / rooms) offered on a listing. */
export function CatalogPicker({ label, items, selected, onToggle, empty }: {
  label: string
  items: Array<{ id: string; label: string }>
  selected: string[]
  onToggle: (id: string) => void
  empty: string
}) {
  return (
    <fieldset className="space-y-1 border border-surface-300 rounded-md p-2">
      <legend className="text-xs font-semibold text-brand-900 px-1">{label}</legend>
      {items.length === 0 ? (
        <p className="text-xs text-brand-900/70">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {items.map(it => (
            <label key={it.id} className="flex items-center gap-1.5 text-xs text-brand-900">
              <input type="checkbox" checked={selected.includes(it.id)} onChange={() => onToggle(it.id)} />
              {it.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

/** The draft / published / archived publish-lifecycle badge. */
export function ListingStatusBadge({ status }: { status: 'draft' | 'published' | 'archived' }) {
  const cls = status === 'published'
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : status === 'draft'
      ? 'bg-amber-100 text-amber-800 border-amber-300'
      : 'bg-slate-100 text-slate-700 border-slate-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${cls}`}>{status}</span>
}

export function ConfirmModal({ title, body, confirmLabel, onClose, onConfirm }: {
  title: string; body: string; confirmLabel: string; onClose: () => void; onConfirm: () => void
}) {
  return (
    <Modal labelledBy="confirm-title" onClose={onClose}>
      <h2 id="confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
      <p className="text-sm text-brand-900">{body}</p>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose}
          className="flex-1 py-2 rounded-lg text-sm font-medium text-brand-900 border border-surface-300 hover:bg-surface-50">{c.cancel}</button>
        <button type="button" onClick={onConfirm}
          className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-red-700 hover:bg-red-800">{confirmLabel}</button>
      </div>
    </Modal>
  )
}

export function Modal({ labelledBy, onClose, children }: {
  labelledBy: string; onClose: () => void; children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
