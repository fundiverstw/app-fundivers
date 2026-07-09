import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { signWaiver, type WaiverEventRef } from '../../lib/waivers'
import { getWaiverPdfSignedUrl } from '../../lib/waiver-pdf'
import type { WaiverDef } from '../../config/waivers'
import { t } from '../../i18n'

const ws = t.waiverSign

// E-signature dialog reused by the profile page and the registration form. The
// diver reads the form text, types their full name and ticks the acknowledgment;
// "Sign" is disabled until both are present. Signing goes through sign_waiver()
// (server-stamped), so there's nothing to backdate here. `event` is passed only
// for per-event waivers — signWaiver ignores it for annual ones.
export function WaiverSignDialog({ def, event, onSigned, onClose }: {
  def: WaiverDef
  event?: WaiverEventRef
  onSigned: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // PDF waivers show the uploaded document instead of a text body.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (def.pdfPath) {
      getWaiverPdfSignedUrl(def.pdfPath).then(u => { if (!cancelled) setPdfUrl(u) })
    }
    return () => { cancelled = true }
  }, [def.pdfPath])

  const canSign = name.trim().length > 0 && agreed && !busy

  async function sign() {
    if (!canSign) return
    setBusy(true); setError(null)
    try {
      await signWaiver({ def, signedName: name.trim(), event })
      onSigned()
    } catch {
      setError(ws.signFailed)
      setBusy(false)
    }
  }

  // Portaled to <body> so the fixed overlay escapes any ancestor that creates
  // a stacking context. Callers mount this inside backdrop-blur'd sections (the
  // profile page) and inside the registration modal; without the portal the
  // overlay is trapped under later siblings (e.g. the Family section).
  return createPortal(
    <div
      className="fixed inset-0 bg-brand-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="dialog" aria-modal="true" aria-labelledby="waiver-title"
    >
      <div className="bg-white/90 backdrop-blur-md rounded-2xl max-w-lg w-full p-6 space-y-4 border border-surface-300 shadow-2xl max-h-[90vh] flex flex-col">
        <h2 id="waiver-title" className="text-lg font-bold text-brand-900">{def.title}</h2>
        {def.pdfPath ? (
          <div className="overflow-hidden border border-surface-200 rounded-lg bg-white/70 grow min-h-[320px] flex flex-col">
            {pdfUrl ? (
              <object data={pdfUrl} type="application/pdf" aria-label={def.title} className="w-full grow min-h-[320px]">
                <p className="text-xs text-brand-950 p-3">
                  {ws.pdfFallbackPrefix}{' '}
                  <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className="underline font-semibold">{ws.pdfOpenNewTab}</a> {ws.pdfFallbackSuffix}
                </p>
              </object>
            ) : (
              <p className="text-xs text-brand-950 p-3">{ws.loadingDocument}</p>
            )}
          </div>
        ) : (
          <div className="text-xs text-brand-950 whitespace-pre-wrap overflow-y-auto border border-surface-200 rounded-lg p-3 bg-white/70 grow">
            {def.body}
          </div>
        )}
        <div className="space-y-2">
          <label className="block">
            <span className="block text-xs text-brand-900 font-medium mb-1 uppercase tracking-wide">{ws.typeFullName}</span>
            <input
              type="text"
              aria-label={ws.fullNameAria}
              value={name}
              disabled={busy}
              onChange={e => setName(e.target.value)}
              className="w-full bg-white border border-surface-300 rounded-lg px-3 py-2 text-brand-900 text-sm focus:outline-none focus:border-brand-900 disabled:opacity-50"
              placeholder={ws.fullNamePlaceholder}
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-brand-900">
            <input
              type="checkbox"
              checked={agreed}
              disabled={busy}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-0.5"
            />
            <span>{ws.agree}</span>
          </label>
          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg border border-surface-300 text-brand-900 text-sm font-semibold disabled:opacity-50 hover:bg-surface-50"
          >
            {ws.cancel}
          </button>
          <button
            type="button"
            onClick={sign}
            disabled={!canSign}
            className="px-4 py-2 rounded-lg bg-brand-900 hover:bg-brand-950 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy ? ws.signing : ws.sign}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
