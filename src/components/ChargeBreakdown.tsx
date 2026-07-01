import type { ChargeLine } from '../lib/booking-charges'
import { chargesTotal } from '../lib/booking-charges'
import { TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE } from '../styles/tokens'

export interface AmendmentLine {
  label: string
  /** Positive = diver owes more; negative = a discount/credit. */
  amount: number
}

/**
 * Itemized list of everything that makes up what a diver owes: the booking
 * charges (base + each extra), then any post-booking amendments (discounts /
 * surcharges), then the Total. Shared by the diver's Bookings/Payments pages
 * and the admin BookingPaymentsBlock so the breakdown reads identically and
 * always ties out to the same Total the Balance figure uses.
 *
 * Pass `total` (the adjusted owed) so the displayed Total matches the Balance
 * even when recomputed lines (old bookings) drift from the recorded figures.
 */
export function ChargeBreakdown({
  lines, currency, total, deposit, amendments,
}: {
  lines: ChargeLine[]
  currency: string
  total?: number | null
  deposit?: number | null
  amendments?: AmendmentLine[]
}) {
  const amends = amendments ?? []
  if (!lines.length && !amends.length) return null
  const shownTotal = total ?? (chargesTotal(lines) + amends.reduce((s, a) => s + a.amount, 0))

  const signed = (amount: number) =>
    `${amount < 0 ? '−' : ''}${currency} ${Math.abs(amount).toLocaleString()}`

  return (
    <div className="space-y-1 text-sm">
      {lines.map((l, i) => (
        <div
          key={`${l.kind}-${i}`}
          className={`flex justify-between gap-3 ${l.kind === 'adjustment' ? `italic ${TEXT_MUTED}` : TEXT_SUBTLE}`}
        >
          <span className="min-w-0 break-words">{l.label}</span>
          <span className="shrink-0 tabular-nums">{signed(l.amount)}</span>
        </div>
      ))}
      {amends.map((a, i) => (
        <div key={`amend-${i}`} className={`flex justify-between gap-3 italic ${TEXT_MUTED}`}>
          <span className="min-w-0 break-words">{a.label}</span>
          <span className="shrink-0 tabular-nums">{signed(a.amount)}</span>
        </div>
      ))}
      <div className={`flex justify-between gap-3 pt-1 mt-1 border-t border-surface-200 ${TEXT_BODY}`}>
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
