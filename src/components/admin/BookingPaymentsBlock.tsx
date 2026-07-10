import { useState } from 'react'
import { siteConfig } from '../../config/site'
import { format } from 'date-fns'
import { errorMessage } from '../../lib/errors'
import { ChargeBreakdown, type AmendmentLine } from '../ChargeBreakdown'
import { bookingBalance } from '../../lib/booking-balance'
import type { ChargeLine } from '../../lib/booking-charges'
import type { Payment } from '../../types/database'
import { t } from '../../i18n'

const bp = t.admin.bookingPayments

/**
 * Per-booking payments block: shows running owed/paid/outstanding tab,
 * lists recorded payments, and (for admin viewers) a free-form amount input
 * for recording payments. The owed/paid figures only ever move from recorded
 * payments + amendments, never from the deposit shortcut.
 *
 * The "Mark deposit paid" button is purely a status action: it confirms a
 * pending booking (deposit received off-app) WITHOUT recording a payment or
 * changing any balance figure. Admins enter the actual amount received via
 * the free-form input and track the remaining balance themselves.
 *
 * Pure render component — caller owns the supabase writes via `onRecord` /
 * `onMarkDepositPaid`. Used on AdminEventDetailPage (one block per
 * registrant) and on AdminUsersPage (one block per active booking).
 */
export function BookingPaymentsBlock({
  payments, owed, paid, credit = 0, pending, cancelled, readOnly, onRecord, onVoid, onMarkDepositPaid,
  charges, amendments, currency, payerNote,
}: {
  payments: Payment[]
  owed: number
  paid: number
  /** When this booking is part of a lead-paid group, a short note naming the
   *  payer (e.g. "Paid by Alex"). Surfaced so staff see at a glance that the
   *  balance belongs to a group rather than this diver alone. */
  payerNote?: string
  /** Open (unsettled) credit awarded to the diver for THIS event. Offsets what
   *  they owe in the Balance figure below. Settled credits don't count. */
  credit?: number
  /** Itemized charge breakdown for this booking (from resolveCharges). When
   *  present, an itemized list is shown above the owed/paid figures so staff
   *  can trace exactly what the diver was charged. */
  charges?: ChargeLine[]
  /** Post-booking adjustments (discounts / surcharges). Shown in the breakdown
   *  after the charges so it ties out to `owed`. */
  amendments?: AmendmentLine[]
  currency?: string
  /** The booking is still 'pending' — gates the "Mark deposit paid" button. */
  pending: boolean
  cancelled: boolean
  readOnly: boolean
  onRecord: (amount: number, note: string) => Promise<void>
  /** Revert a paid payment that was recorded by mistake. Optional — when
   *  omitted, the per-row Void button is hidden (e.g. on read-only or
   *  diver-facing surfaces). The caller owns the supabase write. */
  onVoid?: (paymentId: string) => Promise<void>
  /** Confirm a pending booking (deposit received). Does NOT touch the
   *  balance. Optional — button hidden when absent. Caller owns the write. */
  onMarkDepositPaid?: () => Promise<void>
}) {
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleMarkDepositPaid() {
    if (!onMarkDepositPaid) return
    setError(null)
    setConfirming(true)
    try {
      await onMarkDepositPaid()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setConfirming(false)
    }
  }

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
      setError(bp.amountMustBePositive)
      return
    }
    await submit(amount, note.trim() || bp.paymentFallback)
  }

  async function handleVoid(p: Payment) {
    if (!onVoid) return
    if (!window.confirm(bp.voidConfirm(p.amount.toLocaleString()))) return
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
    <div className="text-xs bg-surface-50 rounded p-2 space-y-2">
      {((charges && charges.length > 0) || (amendments && amendments.length > 0)) && (
        <div className="pb-2 border-b border-surface-200 space-y-1">
          <p className="font-semibold text-brand-900">{bp.charges}</p>
          <ChargeBreakdown lines={charges ?? []} amendments={amendments} total={owed} currency={currency ?? siteConfig.locale.currencyLabel} />
        </div>
      )}

      <p className="font-semibold text-brand-900">{t.payments.title}</p>

      {payerNote && (
        <p className="text-violet-800 font-semibold">{payerNote}</p>
      )}

      {/* Balance = owed − paid − open credit for this event. Positive means the
          diver still owes (red); negative means they're net in credit (green). */}
      {(() => {
        const bal = bookingBalance(owed, paid, credit)
        return (
          <>
            <div className="grid grid-cols-3 gap-2 text-brand-900">
              <div>
                <p className="font-medium opacity-70">{bp.owed}</p>
                <p className="font-semibold">{owed.toLocaleString()}</p>
              </div>
              <div>
                <p className="font-medium opacity-70">{t.payments.paid}</p>
                <p className="font-semibold">{paid.toLocaleString()}</p>
              </div>
              <div>
                <p className="font-medium opacity-70">{t.bookings.balance}</p>
                {bal.state === 'due' && <p className="font-semibold text-red-600">{bp.amountOwed(bal.amount.toLocaleString())}</p>}
                {bal.state === 'credit' && <p className="font-semibold text-emerald-700">{bp.amountCredit(bal.amount.toLocaleString())}</p>}
                {bal.state === 'settled' && <p className="font-semibold text-emerald-700">{t.bookings.settled}</p>}
              </div>
            </div>
            {credit > 0 && (
              <div className="flex justify-between text-emerald-700">
                <span className="font-medium">{t.bookings.creditThisEvent}</span>
                <span className="font-semibold">{credit.toLocaleString()}</span>
              </div>
            )}
            {bal.state === 'credit' && (
              <p className="text-emerald-700">
                {bp.shopOwesDiver(currency ?? siteConfig.locale.currencyLabel, bal.amount.toLocaleString())}
              </p>
            )}
          </>
        )
      })()}

      {payments.length === 0 ? (
        <p className="text-brand-900 font-medium italic">{bp.noPayments}</p>
      ) : (
        <ul className="space-y-1 pt-1 border-t border-surface-200">
          {payments.map(p => {
            // Both 'refunded' (money sent back) and 'voided' (admin mistake)
            // get the strikethrough treatment so the running paid sum lines
            // up visually with what the eye expects.
            const struck = p.status === 'refunded' || p.status === 'voided'
            return (
              <li key={p.id} className="flex items-baseline justify-between gap-2">
                <span className="text-brand-950 font-medium flex-1">
                  {format(new Date(p.created_at), 'MMM d')} · {p.note ?? bp.paymentFallback}
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
                    {voidingId === p.id ? bp.voiding : bp.voidAction}
                  </button>
                )}
                <span className={`shrink-0 font-semibold ${struck ? 'text-brand-950 line-through' : 'text-brand-900'}`}>
                  {p.amount.toLocaleString()}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly && !cancelled && (
        <div className="space-y-1.5 pt-1 border-t border-surface-200">
          {pending && onMarkDepositPaid && (
            <button
              type="button"
              disabled={confirming}
              onClick={handleMarkDepositPaid}
              className="w-full text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded"
            >
              {confirming ? bp.marking : bp.markDepositPaid}
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
                placeholder={bp.paidAmountPlaceholder}
                className="flex-1 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
              />
              <button
                type="submit"
                disabled={submitting}
                className="text-xs bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded shrink-0"
              >
                {submitting ? bp.recording : bp.recordPayment}
              </button>
            </div>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={bp.notePlaceholder}
              maxLength={500}
              className="w-full bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
            />
            {error && <p className="text-red-600">{error}</p>}
          </form>
        </div>
      )}
    </div>
  )
}
