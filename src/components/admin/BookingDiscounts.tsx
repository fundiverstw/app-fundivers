import { useState } from 'react'
import { discountAmount, discountValueLabel, offerableDiscounts } from '../../lib/discounts'
import { siteConfig } from '../../config/site'
import { BTN_XS_BASE } from '../../styles/tokens'
import type { BookingDiscount, Discount } from '../../types/database'
import { t } from '../../i18n'

const bd = t.admin.bookingDiscounts

// One booking's discounts, on the registrant card: what has been asked for,
// what was granted, and the way an admin applies one after the fact.
//
// Both halves live here because they are the same decision seen twice. A
// discount an admin applies from this control is still a REQUEST — it appears
// with Approve / Reject beside it, exactly as one the diver ticked at
// registration does. Making the admin path skip approval would mean two ways
// for money to come off a booking, one of them unrecorded as a decision; the
// extra click is what keeps every discount on the same audit trail.
//
// The money itself never appears here. It is a negative booking_amendments row,
// listed in the charge breakdown above with every other adjustment.
export function BookingDiscounts({
  rows, catalog, currency, bookingTotal, readOnly, canDecide, onRequest, onDecide,
}: {
  rows: BookingDiscount[]
  /** Every active discount — an admin may apply one this event never offered. */
  catalog: Discount[]
  currency?: string
  /** The booking's frozen total, for previewing what a percent would take. */
  bookingTotal: number
  readOnly: boolean
  /** Only admins decide; staff see the list and nothing to press. */
  canDecide: boolean
  onRequest: (discountId: string) => Promise<void>
  onDecide: (requestId: string, approve: boolean) => Promise<void>
}) {
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cur = currency ?? siteConfig.locale.currency
  const byId = new Map(catalog.map(d => [d.id, d]))
  const offerable = offerableDiscounts(catalog, rows)
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString()}`

  async function apply() {
    if (!picked || busy) return
    setBusy(true); setError(null)
    try {
      await onRequest(picked)
      setPicked('')
    } catch {
      setError(bd.addFailed)
    } finally {
      setBusy(false)
    }
  }

  async function decide(requestId: string, approve: boolean) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await onDecide(requestId, approve)
    } catch {
      setError(bd.addFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 border-t border-surface-200 pt-2">
      <p className="text-xs font-semibold text-brand-900 uppercase tracking-wider">{bd.heading}</p>

      {rows.length === 0 ? (
        <p className="text-xs text-brand-950/70 font-medium">{bd.none}</p>
      ) : (
        <ul className="space-y-1">
          {rows.map(row => {
            const d = byId.get(row.discount_id)
            const label = d?.label ?? row.discount_id
            return (
              // Stacked below `sm`: the registrant card is already a narrow
              // column, and two buttons beside the label leave a 320px phone
              // enough room to render the discount's name one letter per line.
              <li key={row.id} className="flex flex-col gap-1 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                <span className="min-w-0 flex-1 text-brand-950 font-medium">
                  <span className="block break-words">
                    {label}
                    {d && <span className="ml-1 text-brand-950/70">{discountValueLabel(d, cur)}</span>}
                  </span>
                  <span className="block text-brand-950/70">
                    {row.status === 'approved'
                      ? `${t.discounts.statusApproved} · ${bd.approvedAmount(money(row.amount ?? 0))}`
                      : row.status === 'rejected'
                        ? t.discounts.statusRejected
                        : t.discounts.statusRequested}
                  </span>
                  {row.note && <span className="block text-brand-950/60 italic break-words">{row.note}</span>}
                </span>
                {!readOnly && canDecide && row.status === 'requested' && (
                  <span className="flex gap-1 shrink-0">
                    <button type="button" disabled={busy} onClick={() => decide(row.id, true)}
                      className={`${BTN_XS_BASE} bg-emerald-100 hover:bg-emerald-200 text-emerald-900`}>
                      {t.admin.discounts.approve}
                    </button>
                    <button type="button" disabled={busy} onClick={() => decide(row.id, false)}
                      className={`${BTN_XS_BASE} bg-red-100 hover:bg-red-200 text-red-800`}>
                      {t.admin.discounts.reject}
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {rows.some(r => r.status === 'requested') && (
        <p className="text-xs text-brand-950/70 font-medium">{bd.pendingHint}</p>
      )}

      {!readOnly && canDecide && offerable.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="booking-discount-pick">{bd.addLabel}</label>
          <select
            id="booking-discount-pick"
            value={picked}
            onChange={e => setPicked(e.target.value)}
            className="flex-1 min-w-0 text-xs bg-white border border-surface-300 rounded px-2 py-1 text-brand-900"
          >
            <option value="">{bd.addPlaceholder}</option>
            {offerable.map(d => (
              <option key={d.id} value={d.id}>
                {d.label} — {discountValueLabel(d, cur)}
                {d.kind === 'percent' ? ` (${money(discountAmount(d, bookingTotal))})` : ''}
              </option>
            ))}
          </select>
          <button type="button" disabled={!picked || busy} onClick={apply}
            className={`${BTN_XS_BASE} bg-surface-100 hover:bg-surface-700 text-brand-900 disabled:opacity-50`}>
            {bd.add}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-700 font-semibold">{error}</p>}
    </div>
  )
}
