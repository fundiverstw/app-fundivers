import { t } from '../../i18n'

const gr = t.admin.groups

export interface PaymentDueRow {
  bookingId: string
  name: string
  /** Outstanding amount, in the shop currency. */
  amount: number
  /** Lead booker responsible for this balance, when the diver is covered. */
  payerName: string | null
}

/**
 * Pending payments for one event: every active diver who still owes, with the
 * amount due and — for a covered diver — the lead booker on the hook for it.
 * Returns null when everyone on the event has settled. Read-only; payments are
 * recorded from the event's Registrants tab.
 */
export function PaymentsDueGroup({ rows, currency }: { rows: PaymentDueRow[]; currency: string }) {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <div role="group" aria-label={gr.paymentsDue} className="bg-white/70 backdrop-blur-md border border-red-300 rounded-xl p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-red-700">{gr.paymentsDue}</h2>
        <span className="text-xs font-semibold text-red-600">{currency} {total.toLocaleString()} outstanding</span>
      </div>
      <ul className="space-y-1">
        {rows.map(r => (
          <li key={r.bookingId} className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-brand-900 font-medium min-w-0">
              {r.name}
              {r.payerName && (
                <span className="text-xs text-violet-700 font-semibold"> · paid by {r.payerName}</span>
              )}
            </span>
            <span className="shrink-0 text-xs font-semibold text-red-600">
              {currency} {r.amount.toLocaleString()} due
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
