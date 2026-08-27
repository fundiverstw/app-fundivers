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
 * Was this booking on the event, as opposed to withdrawn before it?
 *
 * Cancelling an event cancels every booking on it (20260827100000), which is
 * what makes the balances die with the event. The cost is that `status` alone
 * stops separating "this diver was registered" from "this diver had already
 * pulled out" — on a cancelled event both read 'cancelled'.
 *
 * Anything asking WHO WAS ON THIS EVENT has to ask this instead: the roster,
 * the balances view, the headcount, and the cancellation notifications (which
 * express the same test as a PostgREST filter, since they run in the edge
 * function and the push worker). Anything asking whether a booking still owes
 * money keeps asking `status`, which is now right on its own.
 */
export function wasOnEvent(
  booking: Pick<Booking, 'status' | 'status_before_event_cancel'>,
): boolean {
  return booking.status !== 'cancelled' || !!booking.status_before_event_cancel
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
