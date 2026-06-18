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
 */
export function bookingBalance(owed: number, paid: number, credit = 0): BookingBalance {
  const net = owed - paid - credit
  if (net > 0) return { net, amount: net, state: 'due' }
  if (net === 0) return { net, amount: 0, state: 'settled' }
  return { net, amount: -net, state: 'credit' }
}
