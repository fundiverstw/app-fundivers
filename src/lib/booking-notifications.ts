import { supabase } from './supabase'

/**
 * Email a diver that the shop just promoted their waitlisted booking to
 * confirmed.
 *
 * Best-effort and non-blocking, like every other admin-action notification
 * here: the status write has already committed by the time this is called, and
 * a bounced email must not make the admin think the promotion failed. The
 * caller swallows the rejection.
 *
 * Email only. The automatic offer path (cron worker → notify-waitlist-offer)
 * covers a spot the *system* freed; this covers the spot an admin handed over
 * by hand, and the diver may well not have push enabled.
 */
export async function notifyWaitlistConfirmed(bookingId: string): Promise<void> {
  const { error } = await supabase.functions.invoke<{ ok: boolean; sent: boolean }>(
    'notify-booking-confirmed',
    { body: { booking_id: bookingId } },
  )
  if (error) throw error
}
