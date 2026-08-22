import type { Booking } from '../types/database'

// Status → text style for a booking, shared so Bookings and Payments render
// the same color language for each state.
export const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-red-600',
  confirmed: 'text-brand-900 font-semibold',
  cancelled: 'text-brand-900/40 line-through',
  waitlisted: 'text-surface-600',
}

/**
 * Is this status change a promotion off the waitlist?
 *
 * The one booking transition a diver cannot anticipate. Every other status the
 * shop sets follows something the diver did — they registered (pending), they
 * paid (confirmed), they asked to cancel. A waitlisted diver is waiting on a
 * stranger to drop out, so without a message they find out by chance.
 *
 * Deliberately narrow: pending → confirmed is the diver's own deposit landing,
 * and they already know they paid.
 */
export function isWaitlistPromotion(from: Booking['status'], to: Booking['status']): boolean {
  return from === 'waitlisted' && to === 'confirmed'
}

/**
 * May a diver cancel this booking themselves?
 *
 * Only while it is still a queue entry nobody has paid against. Once money is
 * on the booking, self-cancelling would strand it: cancelling flips
 * `bookingBalance` to "settled" and drops the booking out of the diver's
 * account credit, so the amount paid stops showing anywhere while the shop
 * still holds it. Nothing refunds it automatically — the app moves no money —
 * so a paid booking has to go through **Request refund** instead, which puts
 * it in front of an admin who can return the cash or convert it to credit.
 *
 * `refund_requested_at` blocks it too: a request already awaiting a decision
 * must not be pre-empted by a cancel that removes it from the admin queue
 * (which lists only non-cancelled bookings).
 *
 * The DB guard (`bookings_guard_diver_status`) permits a diver to cancel any
 * of their bookings, so this is a product rule, not a security boundary — but
 * it has to be applied at EVERY diver-facing cancel control, not just one.
 */
export function canSelfCancel(
  booking: Pick<Booking, 'status' | 'refund_requested_at'>, netPaid: number,
): boolean {
  return booking.status === 'pending' && netPaid <= 0 && !booking.refund_requested_at
}
