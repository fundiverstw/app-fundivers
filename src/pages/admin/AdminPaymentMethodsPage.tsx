import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import {
  fetchPaymentMethods, savePaymentMethod, deletePaymentMethod,
} from '../../lib/payment-methods'
import { paymentInstructionsFor } from '../../lib/payment-instructions'
import { paymentMethodLabel } from '../../lib/payment-method-format'
import type { PaymentMethod, PaymentMethodInsert } from '../../types/database'
import { t } from '../../i18n'

const pm = t.admin.paymentMethods
const wv = t.admin.waivers

// Admin catalog for how divers can pay. A method's key is what every booking
// records, so it's write-once; everything else — the name, the surcharge, the
// bank account printed on the register form and the emailed PDF — is editable
// here. The form previews the diver-facing block as it's typed, because a
// mistyped account number is a payment that never arrives.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

const KEY_PATTERN = /^[a-z0-9_]{1,50}$/

export function AdminPaymentMethodsPage() {
  const toast = useToast()
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PaymentMethod | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PaymentMethod | null>(null)

  async function reload() {
    try {
      setMethods(await fetchPaymentMethods())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const m = await fetchPaymentMethods()
        if (!cancelled) setMethods(m)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleDelete(m: PaymentMethod) {
    try {
      await deletePaymentMethod(m.id)
      toast.success(pm.deleted)
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{pm.title}</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {pm.newMethod}
        </button>
      </div>
      <p className="text-sm text-white/80">{pm.intro}</p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">{pm.loading}</p>
      ) : methods.length === 0 ? (
        <p className="text-sm text-white/70">{pm.none}</p>
      ) : (
        <ul className="space-y-2">
          {methods.map(m => (
            <li key={m.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {paymentMethodLabel(m)}
                  {!m.active && <span className="ml-2 text-xs text-brand-900/60">{pm.inactive}</span>}
                </p>
                <p className="text-xs text-brand-900/70 truncate">{summarize(m)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(m)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">{pm.edit}</button>
                <button type="button" onClick={() => setConfirmDelete(m)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">{pm.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <MethodForm
          method={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success(pm.saved); await reload() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={pm.deleteTitle}
          body={pm.deleteBody(confirmDelete.label)}
          confirmLabel={pm.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

/** One-line gist for the list row: the account or link a diver would send to. */
function summarize(m: PaymentMethod): string {
  const bits = [m.account_number, m.bank_name, m.pay_url, m.blurb, m.notes]
    .map(v => (v ?? '').trim())
    .filter(Boolean)
  return bits[0] ?? m.key
}

function MethodForm({
  method, onClose, onSaved, onError,
}: {
  method: PaymentMethod | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [label, setLabel] = useState(method?.label ?? '')
  const [key, setKey] = useState(method?.key ?? '')
  const [blurb, setBlurb] = useState(method?.blurb ?? '')
  const [surcharge, setSurcharge] = useState(String(method?.surcharge_percent ?? 0))
  const [bankName, setBankName] = useState(method?.bank_name ?? '')
  const [bankBranch, setBankBranch] = useState(method?.bank_branch ?? '')
  const [bankCode, setBankCode] = useState(method?.bank_code ?? '')
  const [accountNumber, setAccountNumber] = useState(method?.account_number ?? '')
  const [accountHolder, setAccountHolder] = useState(method?.account_holder ?? '')
  const [swift, setSwift] = useState(method?.swift_bic ?? '')
  const [payUrl, setPayUrl] = useState(method?.pay_url ?? '')
  const [notes, setNotes] = useState(method?.notes ?? '')
  const [collectsInvoiceEmail, setCollectsInvoiceEmail] = useState(method?.collects_invoice_email ?? false)
  const [showsShopContact, setShowsShopContact] = useState(method?.shows_shop_contact ?? false)
  const [sortOrder, setSortOrder] = useState(String(method?.sort_order ?? 0))
  const [active, setActive] = useState(method?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  const surchargePercent = Number(surcharge)

  // What a diver will read on the register form and the PDF, rebuilt as the
  // admin types — the point of this page is the details being right.
  const preview = paymentInstructionsFor({
    key: key.trim(),
    label: label.trim() || pm.labelPh,
    surcharge_percent: Number.isFinite(surchargePercent) ? surchargePercent : 0,
    bank_name: bankName,
    bank_branch: bankBranch,
    bank_code: bankCode,
    account_number: accountNumber,
    account_holder: accountHolder,
    swift_bic: swift,
    pay_url: payUrl,
    notes,
    collects_invoice_email: collectsInvoiceEmail,
    shows_shop_contact: showsShopContact,
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!label.trim()) { onError(pm.labelRequired); return }
    if (!KEY_PATTERN.test(key.trim())) { onError(pm.keyRequired); return }
    if (!Number.isFinite(surchargePercent) || surchargePercent < 0 || surchargePercent > 100) {
      onError(pm.surchargeRange); return
    }
    if (payUrl.trim() && !/^https?:\/\//.test(payUrl.trim())) { onError(pm.payUrlInvalid); return }
    setSubmitting(true)
    try {
      const values: PaymentMethodInsert = {
        key: key.trim(),
        label: label.trim(),
        blurb: blurb.trim() || null,
        surcharge_percent: surchargePercent,
        bank_name: bankName.trim() || null,
        bank_branch: bankBranch.trim() || null,
        bank_code: bankCode.trim() || null,
        account_number: accountNumber.trim() || null,
        account_holder: accountHolder.trim() || null,
        swift_bic: swift.trim() || null,
        pay_url: payUrl.trim() || null,
        notes: notes.trim() || null,
        collects_invoice_email: collectsInvoiceEmail,
        shows_shop_contact: showsShopContact,
        sort_order: Number(sortOrder) || 0,
        active,
      }
      await savePaymentMethod(values, method?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="payment-method-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="payment-method-form-title" className="text-lg font-bold text-brand-900">
          {method ? pm.editTitle : pm.newTitle}
        </h2>

        <Labelled label={pm.labelLabel}>
          <input className={FIELD} value={label} onChange={e => setLabel(e.target.value)} placeholder={pm.labelPh} />
        </Labelled>
        <Labelled label={pm.keyLabel} hint={method ? pm.keyLocked : pm.keyHint}>
          <input className={FIELD} value={key} disabled={!!method}
            onChange={e => setKey(e.target.value)} placeholder={pm.keyPh} />
        </Labelled>
        <Labelled label={pm.blurbLabel}>
          <input className={FIELD} value={blurb} onChange={e => setBlurb(e.target.value)} placeholder={pm.blurbPh} />
        </Labelled>
        <Labelled label={pm.surchargeLabel} hint={pm.surchargeHint}>
          <input className={FIELD} type="number" min={0} max={100} step="0.01"
            value={surcharge} onChange={e => setSurcharge(e.target.value)} />
        </Labelled>

        <fieldset className="space-y-3 border-t border-surface-200 pt-3">
          <legend className="text-sm font-semibold text-brand-900">{pm.transferHeading}</legend>
          <p className="text-xs text-brand-900/70">{pm.transferHint}</p>
          <Labelled label={pm.bankNameLabel}>
            <input className={FIELD} value={bankName} onChange={e => setBankName(e.target.value)} />
          </Labelled>
          <Labelled label={pm.bankBranchLabel}>
            <input className={FIELD} value={bankBranch} onChange={e => setBankBranch(e.target.value)} />
          </Labelled>
          <Labelled label={pm.bankCodeLabel}>
            <input className={FIELD} value={bankCode} onChange={e => setBankCode(e.target.value)} />
          </Labelled>
          <Labelled label={pm.accountNumberLabel}>
            <input className={FIELD} value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
          </Labelled>
          <Labelled label={pm.accountHolderLabel}>
            <input className={FIELD} value={accountHolder} onChange={e => setAccountHolder(e.target.value)} />
          </Labelled>
          <Labelled label={pm.swiftLabel}>
            <input className={FIELD} value={swift} onChange={e => setSwift(e.target.value)} />
          </Labelled>
          <Labelled label={pm.payUrlLabel}>
            <input className={FIELD} value={payUrl} onChange={e => setPayUrl(e.target.value)} placeholder={pm.payUrlPh} />
          </Labelled>
        </fieldset>

        <Labelled label={pm.notesLabel}>
          <textarea className={`${FIELD} text-xs`} rows={3} value={notes}
            onChange={e => setNotes(e.target.value)} placeholder={pm.notesPh} />
        </Labelled>

        <label className="flex items-start gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={collectsInvoiceEmail}
            onChange={e => setCollectsInvoiceEmail(e.target.checked)} className="accent-brand-900 mt-0.5" />
          <span>
            {pm.collectsInvoiceEmailLabel}
            <span className="block text-xs text-brand-900/70">{pm.collectsInvoiceEmailHint}</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={showsShopContact}
            onChange={e => setShowsShopContact(e.target.checked)} className="accent-brand-900 mt-0.5" />
          <span>
            {pm.showsShopContactLabel}
            <span className="block text-xs text-brand-900/70">{pm.showsShopContactHint}</span>
          </span>
        </label>

        <Labelled label={pm.sortOrderLabel} hint={pm.sortOrderHint}>
          <input className={FIELD} type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} />
        </Labelled>
        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          {pm.activeLabel}
        </label>

        <div className="border-t border-surface-200 pt-3 space-y-1">
          <p className="text-xs font-semibold text-brand-900">{pm.preview}</p>
          <div className="text-xs text-brand-950 bg-surface-50 border border-surface-200 rounded-lg p-3 space-y-1">
            <p className="font-semibold text-brand-900">{preview.title}</p>
            {preview.lines.map((line, i) => <p key={i} className="break-all">{line}</p>)}
          </div>
        </div>

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

function Labelled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-brand-900">{label}</span>
      {children}
      {hint && <span className="block text-xs text-brand-900/70">{hint}</span>}
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
      role="dialog" aria-modal="true" aria-labelledby="payment-method-confirm-title" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h2 id="payment-method-confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
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
