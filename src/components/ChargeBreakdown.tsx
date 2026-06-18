import type { ChargeLine } from '../lib/booking-charges'
import { chargesTotal } from '../lib/booking-charges'
import { TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE } from '../styles/tokens'

/**
 * Itemized list of a booking's charges (base + every additional charge with its
 * amount), followed by a Total and an optional Deposit line. Shared by the
 * diver's Bookings/Payments pages and the admin BookingPaymentsBlock so the
 * breakdown reads identically everywhere. `lines` come from resolveCharges().
 *
 * `total`/`deposit` default to the stored booking snapshot; pass them through
 * so the figures match what the diver actually owes even when recomputed lines
 * (old bookings) drift slightly from the frozen total.
 */
export function ChargeBreakdown({
  lines, currency, total, deposit,
}: {
  lines: ChargeLine[]
  currency: string
  total?: number | null
  deposit?: number | null
}) {
  if (!lines.length) return null
  const shownTotal = total ?? chargesTotal(lines)

  return (
    <div className="space-y-1 text-sm">
      {lines.map((l, i) => (
        <div
          key={`${l.kind}-${i}`}
          className={`flex justify-between gap-3 ${l.kind === 'adjustment' ? `italic ${TEXT_MUTED}` : TEXT_SUBTLE}`}
        >
          <span className="min-w-0 break-words">{l.label}</span>
          <span className="shrink-0 tabular-nums">
            {l.amount < 0 ? '−' : ''}{currency} {Math.abs(l.amount).toLocaleString()}
          </span>
        </div>
      ))}
      <div className={`flex justify-between gap-3 pt-1 mt-1 border-t border-sky-200 ${TEXT_BODY}`}>
        <span>Total</span>
        <span className="shrink-0 tabular-nums font-semibold">{currency} {shownTotal.toLocaleString()}</span>
      </div>
      {deposit != null && deposit > 0 && (
        <div className={`flex justify-between gap-3 ${TEXT_SUBTLE}`}>
          <span>Deposit to hold spot</span>
          <span className="shrink-0 tabular-nums">{currency} {deposit.toLocaleString()}</span>
        </div>
      )}
    </div>
  )
}
