import type { Booking } from '../types/database'

// Status → text style for a booking, shared so Bookings and Payments render
// the same colour language for each state.
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
