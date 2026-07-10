import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchAllWaivers, saveWaiver, deleteWaiver } from '../../lib/waivers'
import { uploadWaiverPdf, getWaiverPdfSignedUrl } from '../../lib/waiver-pdf'
import type { WaiverRow, WaiverInsert } from '../../types/database'
import type { WaiverCadence, WaiverAppliesTo } from '../../config/waivers'
import { t } from '../../i18n'

const wv = t.admin.waivers

// Admin catalog for the shop's own waivers. Each is a free-form form the shop
// authors — a text body OR an uploaded PDF, in whatever language they need — and
// attaches to events (per-event require/exempt lives on the Edit-event form).
// `code` + `version` are the stable keys signatures reference; editing the
// content bumps the version so everyone re-signs.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminWaiversPage() {
  const toast = useToast()
  const [waivers, setWaivers] = useState<WaiverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<WaiverRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<WaiverRow | null>(null)

  async function reload() {
    try {
      setWaivers(await fetchAllWaivers())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const w = await fetchAllWaivers()
        if (!cancelled) setWaivers(w)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleDelete(w: WaiverRow) {
    try {
      await deleteWaiver(w.id)
      toast.success(wv.deleted)
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{wv.title}</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {wv.newWaiver}
        </button>
      </div>
      <p className="text-sm text-white/80">
        {wv.intro}
      </p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">{wv.loading}</p>
      ) : waivers.length === 0 ? (
        <p className="text-sm text-white/70">{wv.none}</p>
      ) : (
        <ul className="space-y-2">
          {waivers.map(w => (
            <li key={w.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {w.title}{!w.active && <span className="ml-2 text-xs text-brand-900/60">{wv.inactive}</span>}
                </p>
                <p className="text-xs text-brand-900/80">
                  {w.pdf_path ? wv.pdf : wv.text} · {w.cadence === 'annual' ? wv.cadenceAnnual : wv.cadencePerEvent} · {wv.appliesToPrefix} {wv.appliesLabel(w.applies_to)}
                  {w.language ? ` · ${w.language}` : ''} · v{w.version}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(w)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">{wv.edit}</button>
                <button type="button" onClick={() => setConfirmDelete(w)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">{wv.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <WaiverForm
          waiver={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success(wv.saved); await reload() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={wv.deleteTitle}
          body={wv.deleteBody(confirmDelete.title)}
          confirmLabel={wv.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function WaiverForm({
  waiver, onClose, onSaved, onError,
}: {
  waiver: WaiverRow | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [title, setTitle] = useState(waiver?.title ?? '')
  const [code, setCode] = useState(waiver?.code ?? '')
  const [language, setLanguage] = useState(waiver?.language ?? '')
  const [cadence, setCadence] = useState<WaiverCadence>(waiver?.cadence ?? 'annual')
  const [appliesTo, setAppliesTo] = useState<WaiverAppliesTo>(waiver?.applies_to ?? 'none')
  const [courseColors, setCourseColors] = useState((waiver?.course_colors ?? []).join(', '))
  const [active, setActive] = useState(waiver?.active ?? true)
  const [mode, setMode] = useState<'text' | 'pdf'>(waiver?.pdf_path ? 'pdf' : 'text')
  const [body, setBody] = useState(waiver?.body ?? '')
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (waiver?.pdf_path) {
      getWaiverPdfSignedUrl(waiver.pdf_path).then(u => { if (!cancelled) setPdfUrl(u) })
    }
    return () => { cancelled = true }
  }, [waiver?.pdf_path])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) { onError(wv.titleRequired); return }
    if (!code.trim()) { onError(wv.codeRequired); return }
    if (mode === 'text' && !body.trim()) { onError(wv.textRequired); return }
    if (mode === 'pdf' && !pdfFile && !waiver?.pdf_path) { onError(wv.pdfRequired); return }
    setSubmitting(true)
    try {
      const id = waiver?.id ?? crypto.randomUUID()
      let pdfPath = mode === 'pdf' ? (waiver?.pdf_path ?? null) : null
      if (mode === 'pdf' && pdfFile) pdfPath = await uploadWaiverPdf(id, pdfFile)

      // Bump the version when the content changes so signatures re-prompt.
      const contentChanged = waiver
        ? (mode === 'text' ? body !== (waiver.body ?? '') : !!pdfFile || waiver.pdf_path == null)
        : false
      const version = (waiver?.version ?? 0) + (waiver ? (contentChanged ? 1 : 0) : 1)

      const colors = courseColors.split(',').map(s => s.trim()).filter(Boolean)
      const values: WaiverInsert = {
        id,
        code: code.trim(),
        title: title.trim(),
        language: language.trim() || null,
        cadence,
        applies_to: appliesTo,
        course_colors: colors.length ? colors : null,
        active,
        version,
        body: mode === 'text' ? body : null,
        pdf_path: mode === 'pdf' ? pdfPath : null,
      }
      await saveWaiver(values, waiver?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="waiver-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="waiver-form-title" className="text-lg font-bold text-brand-900">{waiver ? wv.editWaiver : wv.newWaiverTitle}</h2>

        <Labelled label={wv.titleLabel}>
          <input className={FIELD} value={title} onChange={e => setTitle(e.target.value)} placeholder={wv.titlePh} />
        </Labelled>
        <Labelled label={wv.codeLabel}>
          <input className={FIELD} value={code} onChange={e => setCode(e.target.value)} placeholder={wv.codePh} disabled={!!waiver} />
        </Labelled>
        <Labelled label={wv.languageLabel}>
          <input className={FIELD} value={language} onChange={e => setLanguage(e.target.value)} placeholder={wv.languagePh} />
        </Labelled>

        <div className="grid grid-cols-2 gap-2">
          <Labelled label={wv.cadence}>
            <select className={FIELD} value={cadence} onChange={e => setCadence(e.target.value as WaiverCadence)}>
              <option value="annual">{wv.cadenceAnnualLong}</option>
              <option value="per_event">{wv.cadencePerEvent}</option>
            </select>
          </Labelled>
          <Labelled label={wv.autoApplies}>
            <select className={FIELD} value={appliesTo} onChange={e => setAppliesTo(e.target.value as WaiverAppliesTo)}>
              <option value="none">{wv.applyNone}</option>
              <option value="dives">{wv.applyDives}</option>
              <option value="courses">{wv.applyCourses}</option>
              <option value="all">{wv.applyAll}</option>
            </select>
          </Labelled>
        </div>
        {(appliesTo === 'courses' || appliesTo === 'all') && (
          <Labelled label={wv.courseLimit}>
            <input className={FIELD} value={courseColors} onChange={e => setCourseColors(e.target.value)} placeholder={wv.courseLimitPh} />
          </Labelled>
        )}

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-brand-900">{wv.content}</legend>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="radio" name="waiver-mode" checked={mode === 'text'} onChange={() => setMode('text')} className="accent-brand-900" />
            {wv.typeText}
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-900">
            <input type="radio" name="waiver-mode" checked={mode === 'pdf'} onChange={() => setMode('pdf')} className="accent-brand-900" />
            {wv.uploadPdf}
          </label>
          {mode === 'text' ? (
            <textarea className={`${FIELD} font-mono text-xs`} rows={8} value={body} onChange={e => setBody(e.target.value)}
              aria-label={wv.waiverTextAria}
              placeholder={wv.waiverTextPh} />
          ) : (
            <div className="space-y-1">
              {waiver?.pdf_path && (
                <p className="text-xs text-brand-900/80">
                  {wv.current} {pdfUrl
                    ? <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="underline">{wv.viewPdf}</a>
                    : wv.pdfOnFile}{wv.replaceHint}
                </p>
              )}
              <input type="file" accept="application/pdf" aria-label={wv.waiverPdfAria}
                onChange={e => setPdfFile(e.target.files?.[0] ?? null)} className="text-sm text-brand-900" />
            </div>
          )}
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          {wv.activeLabel}
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
      role="dialog" aria-modal="true" aria-labelledby="waiver-confirm-title" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 id="waiver-confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
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
