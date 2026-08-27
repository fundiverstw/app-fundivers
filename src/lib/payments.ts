// The single source of truth for "how much has actually been paid toward a
// booking". `payments` is an append-only ledger: a refund is its own row with
// status='refunded', never a mutation of the original 'paid' row. So the money
// net received is paid minus refunded — pending and voided rows don't count.
//
// Every balance surface (the diver's Payments/Bookings pages, the admin event/
// users/logistics views, the cancellation refund, and the Audits
// reconciliation) must sum paid the same way, or a refund would make them
// silently disagree — the diver pages would read an overpayment as spendable
// credit while the Audits page shows it settled.

export interface PaymentLike {
  status: string | null
  amount: number
}

/** Net money received across a set of payments: 'paid' adds, 'refunded'
 *  subtracts, everything else (pending, voided) is ignored. */
export function netPaid(payments: readonly PaymentLike[]): number {
  return payments.reduce((sum, p) => {
    if (p.status === 'paid') return sum + Number(p.amount)
    if (p.status === 'refunded') return sum - Number(p.amount)
    return sum
  }, 0)
}

/** Net paid per booking, keyed by booking_id, for payment rows that span
 *  several bookings. Rows with a null booking_id are skipped. */
export function netPaidByBooking(
  payments: ReadonlyArray<PaymentLike & { booking_id: string | null }>,
): Map<string, number> {
  const byBooking = new Map<string, number>()
  for (const p of payments) {
    if (!p.booking_id) continue
    const delta =
      p.status === 'paid' ? Number(p.amount)
      : p.status === 'refunded' ? -Number(p.amount)
      : 0
    if (delta !== 0) byBooking.set(p.booking_id, (byBooking.get(p.booking_id) ?? 0) + delta)
  }
  return byBooking
}

/**
 * The one payment method that moves no real money: applying account credit
 * inserts a `paid` row so the booking's balance clears, but nothing arrives at
 * the shop — the cash arrived earlier, on whatever booking generated the
 * credit.
 */
export const INTERNAL_PAYMENT_METHOD = 'account_credit'

/**
 * Did this payment move money in or out of the shop?
 *
 * Cash-revenue aggregations must ask this. Summing every `paid` row
 * double-counts: 3000 arrives as cash on a dive, the dive is cancelled, the
 * diver's 3000 credit is spent on the next dive, and a naive sum reports 6000
 * of revenue against 3000 of real money. Balance math is the opposite — there
 * an account-credit row absolutely counts, because it really did settle that
 * booking — which is why this is a reporting predicate, not a netPaid change.
 */
export function isExternalPayment(payment: { method: string | null }): boolean {
  return payment.method !== INTERNAL_PAYMENT_METHOD
}
