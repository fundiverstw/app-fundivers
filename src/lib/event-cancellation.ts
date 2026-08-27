import { supabase } from './supabase'
import { RETURN_SOURCES } from './credits'
import type { AppEvent } from '../types/database'

// Push worker base URL (same host as the other /admin-* endpoints). Empty
// in dev so the push/inbox call is a silent no-op.
const PUSH_WORKER_URL = (import.meta.env.VITE_PUSH_WORKER_URL as string | undefined) ?? ''

// Notify every non-cancelled registrant that an event was cancelled, across
// all three channels. Best-effort and non-blocking: a notification failure
// must never block the cancellation itself (the DB write already succeeded).
//
// Two backends because of where the keys live: the push worker owns the
// VAPID key (push + in-app inbox row), and the Supabase edge function owns
// Gmail SMTP (email). Both are fired and any error is swallowed by the
// caller's .catch.
export async function notifyEventCancelled(eventId: string, eventType: AppEvent['type']): Promise<void> {
  await Promise.allSettled([
    postCancellationPush(eventId, eventType),
    supabase.functions.invoke('notify-event-cancellation', {
      body: { event_id: eventId, event_type: eventType },
    }),
  ])
}

async function postCancellationPush(eventId: string, eventType: AppEvent['type']): Promise<void> {
  if (!PUSH_WORKER_URL) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  await fetch(`${PUSH_WORKER_URL.replace(/\/$/, '')}/admin-event-cancellation`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ event_id: eventId, event_type: eventType }),
  })
}

export interface CancelEventResult {
  /** Divers holding a cancellation credit for this event. */
  credited: number
  creditedAmount: number
}

/**
 * Cancel one event and do everything that has to follow.
 *
 * The money is no longer this function's business. Cancelling the event
 * cancels the bookings on it (20260827100000), and cancelling a booking is
 * already what issues its refund — so the credits are written by the same
 * trigger that has always handled a single cancellation, inside the same
 * transaction as the cancel. They can no longer half-happen, which is what the
 * old `creditError` existed to report.
 *
 * What is left is the notify, which the DB has no business doing, and a read
 * of what the cancellation actually produced so the admin sees a figure that
 * came from the ledger rather than from this client's arithmetic.
 *
 * Still extracted so the "cancel the rest of this series" action cannot drift
 * from the single-event one: a bulk UPDATE would skip the notify silently.
 */
export async function cancelEventAndFollowUp(args: {
  eventId: string
  eventType: AppEvent['type']
  at?: string
}): Promise<CancelEventResult> {
  const { eventId, eventType, at } = args
  const { error } = await supabase
    .from('events')
    .update({ cancelled_at: at ?? new Date().toISOString() } as never)
    .eq('id', eventId)
  if (error) throw error

  notifyEventCancelled(eventId, eventType).catch(() => { /* best-effort */ })

  return countCancellationCredits(eventId)
}

/** What the cancellation handed back, read from the ledger it landed in. */
async function countCancellationCredits(eventId: string): Promise<CancelEventResult> {
  const { data: bookings } = await supabase
    .from('bookings').select('id').eq('event_id', eventId)
  const bookingIds = (bookings ?? []).map(b => b.id)
  if (!bookingIds.length) return { credited: 0, creditedAmount: 0 }

  const { data: credits } = await supabase
    .from('credits')
    .select('amount')
    .in('booking_id', bookingIds)
    .in('source', RETURN_SOURCES)
    .eq('status', 'open')
  const rows = credits ?? []
  return {
    credited: rows.length,
    creditedAmount: rows.reduce((s, c) => s + Number(c.amount), 0),
  }
}
