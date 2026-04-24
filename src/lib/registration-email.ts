import { supabase } from './supabase'

// Kick the send-registration-pdf edge function so fundiverstw@gmail.com
// and the diver each get a PDF summary of the just-submitted booking.
// Fire-and-forget on purpose — the booking has already been saved, so
// any email failure is a logistics problem (retried from admin view),
// not a reason to roll back the user-visible success state.
export function sendRegistrationPdfEmail(bookingId: string): void {
  supabase.functions
    .invoke('send-registration-pdf', { body: { booking_id: bookingId } })
    .catch(err => { console.warn('send-registration-pdf failed:', err) })
}
