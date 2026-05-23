import { useState } from 'react'
import { format } from 'date-fns'
import { errorMessage } from '../../lib/errors'
import type { Payment } from '../../types/database'

/**
 * Per-booking payments block: shows running owed/paid/outstanding tab,
 * lists recorded payments, and (for admin viewers) offers a "Mark deposit
 * paid" shortcut plus a free-form amount input for partial balance payments.
 *
 * Pure render component — caller owns the supabase write via `onRecord`.
 * Used on AdminEventDetailPage (one block per registrant) and on
 * AdminUsersPage (one block per active booking).
 */
export function BookingPaymentsBlock({
  payments, owed, paid, outstanding, depositDue, cancelled, readOnly, onRecord, onVoid,
}: {
  payments: Payment[]
  owed: number
  paid: number
  outstanding: number
  depositDue: number
  cancelled: boolean
  readOnly: boolean
  onRecord: (amount: number, note: string) => Promise<void>
  /** Revert a paid payment that was recorded by mistake. Optional — when
   *  omitted, the per-row Void button is hidden (e.g. on read-only or
   *  diver-facing surfaces). The caller owns the supabase write. */
  onVoid?: (paymentId: string) => Promise<void>
}) {
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(amount: number, defaultNote: string) {
    setError(null)
    setSubmitting(true)
    try {
      await onRecord(amount, defaultNote)
      setAmountStr('')
      setNote('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amount = parseInt(amountStr, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive integer.')
      return
    }
    await submit(amount, note.trim() || 'Payment')
  }

  async function handleVoid(p: Payment) {
    if (!onVoid) return
    if (!window.confirm(`Void this ${p.amount.toLocaleString()} payment? It stays on record for audit but no longer counts toward paid sum.`)) return
    setError(null)
    setVoidingId(p.id)
    try {
      await onVoid(p.id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setVoidingId(null)
    }
  }

  return (
    <div className="text-xs bg-sky-50 rounded p-2 space-y-2">
      <p className="font-semibold text-blue-900">Payments</p>

      <div className="grid grid-cols-3 gap-2 text-blue-900">
        <div>
          <p className="font-medium opacity-70">Owed</p>
          <p className="font-semibold">{owed.toLocaleString()}</p>
        </div>
        <div>
          <p className="font-medium opacity-70">Paid</p>
          <p className="font-semibold">{paid.toLocaleString()}</p>
        </div>
        <div>
          <p className="font-medium opacity-70">Outstanding</p>
          <p className={`font-semibold ${outstanding > 0 ? 'text-red-600' : ''}`}>
            {outstanding.toLocaleString()}
            {outstanding === 0 && owed > 0 && ' ✓'}
          </p>
        </div>
      </div>

      {payments.length === 0 ? (
        <p className="text-blue-900 font-medium italic">No payments recorded yet.</p>
      ) : (
        <ul className="space-y-1 pt-1 border-t border-sky-200">
          {payments.map(p => {
            // Both 'refunded' (money sent back) and 'voided' (admin mistake)
            // get the strikethrough treatment so the running paid sum lines
            // up visually with what the eye expects.
            const struck = p.status === 'refunded' || p.status === 'voided'
            return (
              <li key={p.id} className="flex items-baseline justify-between gap-2">
                <span className="text-blue-950 font-medium flex-1">
                  {format(new Date(p.created_at), 'MMM d')} · {p.note ?? 'Payment'}
                  {p.method && <span className="opacity-70"> ({p.method.replace('_', ' ')})</span>}
                  {p.status !== 'paid' && <span className="text-red-600"> · {p.status}</span>}
                </span>
                {/* Void is only meaningful on rows that *are* counted as paid
                    today. Refunded / voided / pending rows show no button. */}
                {!readOnly && !cancelled && onVoid && p.status === 'paid' && (
                  <button
                    type="button"
                    disabled={voidingId === p.id}
                    onClick={() => handleVoid(p)}
                    className="shrink-0 text-[10px] text-red-700 hover:text-red-900 underline disabled:opacity-50"
                  >
                    {voidingId === p.id ? 'Voiding…' : 'Void'}
                  </button>
                )}
                <span className={`shrink-0 font-semibold ${struck ? 'text-blue-950 line-through' : 'text-blue-900'}`}>
                  {p.amount.toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly && !cancelled && (
        <div className="space-y-1.5 pt-1 border-t border-sky-200">
          {depositDue > 0 && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => submit(depositDue, 'Deposit')}
              className="w-full text-xs bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded"
            >
              {submitting ? 'Recording…' : `Mark deposit paid (${depositDue.toLocaleString()})`}
            </button>
          )}

          <form onSubmit={handleSubmit} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
                placeholder="Paid amount"
                className="flex-1 bg-white border border-sky-300 rounded px-2 py-1 text-xs text-blue-900"
              />
              <button
                type="submit"
                disabled={submitting}
                className="text-xs bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded shrink-0"
              >
                {submitting ? 'Recording…' : 'Record payment'}
              </button>
            </div>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional, e.g. Balance, Partial #2)"
              maxLength={500}
              className="w-full bg-white border border-sky-300 rounded px-2 py-1 text-xs text-blue-900"
            />
            {error && <p className="text-red-600">{error}</p>}
          </form>
        </div>
      )}
    </div>
  )
}
