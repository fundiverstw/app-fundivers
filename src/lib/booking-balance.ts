/** A diver's settled position on one event, used to render the "Balance"
 *  figure consistently across the admin and diver surfaces. */
export type BalanceState =
  | 'due'       // diver still owes money (red)
  | 'settled'   // owed exactly covered by paid + credit
  | 'credit'    // net in the diver's favour because of an *awarded* credit (green)
  | 'overpaid'  // net in the diver's favour because they *paid more than owed*,
                // with no awarded credit — NOT an account credit (amber)

export interface BookingBalance {
  /** owed − paid − credit. Positive = diver owes; negative = in diver's favour. */
  net: number
  /** Absolute amount to display. */
  amount: number
  state: BalanceState
}

/**
 * Net a diver's position for one event. `credit` is the *open awarded* credit
 * for this event (from the credits table), kept distinct from a plain
 * overpayment so the UI never mislabels "paid too much" as an account credit —
 * that conflation is exactly what made an event read "550 credit" while the
 * profile's Account Credits correctly showed 0.
 */
export function bookingBalance(owed: number, paid: number, credit = 0): BookingBalance {
  const net = owed - paid - credit
  if (net > 0) return { net, amount: net, state: 'due' }
  if (net === 0) return { net, amount: 0, state: 'settled' }
  return { net, amount: -net, state: credit > 0 ? 'credit' : 'overpaid' }
}
