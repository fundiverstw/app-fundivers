import { supabase } from './supabase'
import type { BookingDetails } from '../types/database'

// Flip a booking's transport choice (needs ride / self) from the admin event
// page. This is a LOGISTICS-only edit: it sets details.transportation and
// nothing else — the frozen charge snapshot (details.charges / details.total)
// is deliberately untouched, so what the diver was billed never changes here.
// Admins may edit details freely; the diver-only detail lock
// (bookings_block_diver_detail_edits) doesn't apply to them.
export async function setBookingTransportation(
  bookingId: string,
  currentDetails: BookingDetails | null | undefined,
  value: boolean,
): Promise<BookingDetails> {
  const next: BookingDetails = { ...(currentDetails ?? {}), transportation: value }
  const { error } = await supabase.from('bookings').update({ details: next }).eq('id', bookingId)
  if (error) throw error
  return next
}
