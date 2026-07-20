/** A diver's settled position on one event, used to render the "Balance"
 *  figure consistently across the admin and diver surfaces. */
export type BalanceState =
  | 'due'      // diver still owes money (red)
  | 'settled'  // owed exactly covered by paid + credit
  | 'credit'   // net in the diver's favour — the shop owes them this much,
               // whether from an awarded credit or from paying more than owed
               // (an overpayment is money owed back, i.e. a credit) (green)

export interface BookingBalance {
  /** owed − paid − credit. Positive = diver owes; negative = in diver's favour. */
  net: number
  /** Absolute amount to display. */
  amount: number
  state: BalanceState
}

/**
 * Net a diver's position for one event. `credit` is the *open awarded* credit
 * for this event (from the credits table). A negative result means the shop
 * owes the diver — either because an awarded credit exceeds what's owed or
 * because they simply paid more than owed. Both are "credit" to the diver: an
 * overpayment is money owed back, so we no longer split it out as a separate
 * "overpaid" state (the shop still owes it).
 *
 * A **cancelled** booking has no live balance: the event won't happen, so the
 * diver owes nothing further. Any money they paid is returned out-of-band as a
 * cancellation credit (issueCancellationCredits) — a separate open credit row,
 * tied to this booking and equal to what they paid. Netting owed − paid − that
 * credit here would double-count the refund (and, with the frozen `owed` still
 * positive, wrongly show the diver "owing" the rest of a cancelled event). So a
 * cancelled booking short-circuits to a zero, settled balance; the refund shows
 * up as account credit elsewhere. Pass `cancelled` at every site that renders a
 * cancelled booking's balance (most surfaces exclude them from balance sums).
 */
export function bookingBalance(
  owed: number, paid: number, credit = 0, opts: { cancelled?: boolean } = {},
): BookingBalance {
  if (opts.cancelled) return { net: 0, amount: 0, state: 'settled' }
  const net = owed - paid - credit
  if (net > 0) return { net, amount: net, state: 'due' }
  if (net === 0) return { net, amount: 0, state: 'settled' }
  return { net, amount: -net, state: 'credit' }
}

/**
 * The deposit a diver can actually still be asked for.
 *
 * `details.deposit` is frozen at booking time and, unlike the total, nothing
 * reduces it afterwards — amendments move `owed`, never the deposit. So a
 * discount that takes the balance below the original deposit used to leave the
 * deposit demanding the difference: a diver on a 3000 booking discounted to
 * 2600 who paid all 2600 saw "Total 2600 · Paid 2600 · Balance settled" beside
 * "Deposit 400 due" — money nobody owed.
 *
 * A deposit is a down payment ON the balance, so it can never exceed it. Clamp
 * to `owed` and the contradiction is impossible: when the balance is settled,
 * nothing is due.
 */
export function depositDue(deposit: number, owed: number, paid: number): number {
  return Math.max(0, Math.min(deposit, owed) - paid)
}

/** True when the deposit is satisfied — the threshold that confirms a spot. */
export function depositCovered(deposit: number, owed: number, paid: number): boolean {
  return depositDue(deposit, owed, paid) === 0
}
