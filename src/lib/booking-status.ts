import type { Booking } from '../types/database'

// Status → text style for a booking, shared so Bookings and Payments render
// the same colour language for each state.
export const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-red-600',
  confirmed: 'text-brand-900 font-semibold',
  cancelled: 'text-brand-900/40 line-through',
  waitlisted: 'text-surface-600',
}
