// Authoritative server-side money math for a dive/course registration. The
// browser (RegisterForm.tsx) computes details.total / details.deposit for its
// live preview, but those figures must never be trusted: apply_credit_to_booking
// and record_group_payment read details.total as the amount owed, and
// apply_credit reads details.deposit as the confirm-on-deposit threshold. A
// crafted request could otherwise send total=0 and owe nothing.
//
// This mirrors the amount math in src/lib/booking-charges.ts (resolveCharges)
// and RegisterForm's deposit formula exactly; src/lib/booking-charges.test.ts's
// parity case asserts the two agree. Dependency-free so the edge function's
// vitest suite can import it from Node.

export interface BookingMoneyInput {
  // Base price and per-event figures, resolved server-side from the event's
  // linked prices row (starting_at / deposit_amount / transport) and dive_days.
  base: number
  diveDays: number
  depositAmount: number
  transportPrice: number
  // Resolved catalog amounts for the diver's selections.
  gearItems: string[]
  gearPrices: Record<string, number>
  roomAddedPrice: number
  addonsTotal: number
  // The diver's choices (trusted as intent; prices above are authoritative).
  needsTransport: boolean
  nitroxCourse: boolean
  nitroxCourseFee: number
  paymentMethod: string | null | undefined
  payDepositOnly: boolean
}

// Card and PayPal both carry a 5% surcharge; cash / bank transfer pass through.
// Hardcoded 0.05 to match RegisterForm and resolveCharges (the config
// cardSurchargePercent only drives the display label, not the rate).
function surchargeRate(method: string | null | undefined): number {
  return method === 'credit_card' || method === 'paypal' ? 0.05 : 0
}

export interface BookingMoney {
  // Full amount owed for the booking, frozen into details.total.
  total: number
  // Amount due now to secure the spot (face deposit + its card surcharge),
  // frozen into details.deposit. null when the event has no deposit.
  deposit: number | null
  subTotal: number
}

export function computeBookingMoney(input: BookingMoneyInput): BookingMoney {
  const days = Math.max(1, input.diveDays || 1)
  const gearCost = input.gearItems.reduce(
    (s, item) => s + (input.gearPrices[item] ?? 0) * days,
    0,
  )
  const transportCost =
    input.transportPrice > 0 && input.needsTransport ? input.transportPrice : 0
  const nitroxCost = input.nitroxCourse ? input.nitroxCourseFee : 0

  const subTotal =
    input.base +
    gearCost +
    input.roomAddedPrice +
    input.addonsTotal +
    transportCost +
    nitroxCost

  const rate = surchargeRate(input.paymentMethod)
  const hasDeposit = input.depositAmount > 0
  const depositFace = hasDeposit ? Math.min(input.depositAmount, subTotal) : 0
  const payingDepositOnly = hasDeposit && input.payDepositOnly

  const fullSurcharge = Math.round(subTotal * rate)
  const depositSurcharge = Math.round(depositFace * rate)

  const total = subTotal + (payingDepositOnly ? depositSurcharge : fullSurcharge)
  const deposit = hasDeposit ? depositFace + depositSurcharge : null

  return { total, deposit, subTotal }
}
