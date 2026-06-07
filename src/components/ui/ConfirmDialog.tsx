import { useState } from 'react'
import { errorMessage } from '../../lib/errors'
import {
  MODAL_BACKDROP, MODAL_PANEL, BTN_PRIMARY, BTN_GHOST, TEXT_HEADING, TEXT_BODY, TEXT_ERROR,
} from '../../styles/tokens'

// Generic confirm modal. `onConfirm` may be async — the dialog shows an
// in-flight state, surfaces any thrown error inline (via errorMessage),
// and stays open on failure so the user can retry or cancel. Mirrors the
// MODAL_BACKDROP / MODAL_PANEL layout used by BusyEntryModal.

interface ConfirmDialogProps {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleConfirm() {
    setBusy(true)
    setErr(null)
    try {
      await onConfirm()
    } catch (e) {
      setErr(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className={MODAL_BACKDROP} onClick={busy ? undefined : onCancel} role="presentation">
      <div className="flex items-start justify-center px-4 pt-8 pb-4 h-full overflow-y-auto">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={e => e.stopPropagation()}
          className={`${MODAL_PANEL} w-full max-w-sm p-6 space-y-4`}
        >
          <h2 className={`${TEXT_HEADING} text-lg`}>{title}</h2>
          <div className={`${TEXT_BODY} text-sm`}>{message}</div>
          {err && <p className={`${TEXT_ERROR} text-xs`}>{err}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={handleConfirm} disabled={busy} className={`${BTN_PRIMARY} flex-1`}>
              {busy ? 'Saving…' : confirmLabel}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className={BTN_GHOST}>
              {cancelLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
