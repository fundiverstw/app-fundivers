import { supabase } from './supabase'
import { issueCancellationCredits } from './credits'
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
  /** Divers issued a cancellation credit. */
  credited: number
  creditedAmount: number
  /** Set when the credits failed AFTER the cancellation committed — the event
   *  IS cancelled, and the shop has to issue those credits by hand. */
  creditError: unknown
}

/**
 * Cancel one event and do everything that has to follow: notify the
 * registrants, then credit each of them what they paid.
 *
 * Extracted so the "cancel the rest of this series" action cannot drift from
 * the single-event one. A bulk UPDATE over the remaining occurrences would be
 * two lines and silently skip both follow-ups — divers on the later dates would
 * find their dive gone with no message and no refund.
 *
 * Throws only if the cancellation itself fails. The notify is fire-and-forget
 * by design, and a credit failure is reported rather than thrown because the
 * cancellation has already committed and cannot be undone by rejecting here.
 */
export async function cancelEventAndFollowUp(args: {
  event: AppEvent
  createdBy: string | null
  at?: string
}): Promise<CancelEventResult> {
  const { event, createdBy, at } = args
  const { error } = await supabase
    .from('events')
    .update({ cancelled_at: at ?? new Date().toISOString() } as never)
    .eq('id', event.id)
  if (error) throw error

  notifyEventCancelled(event.id, event.type).catch(() => { /* best-effort */ })

  if (!createdBy) return { credited: 0, creditedAmount: 0, creditError: null }
  try {
    const { issued, totalAmount } = await issueCancellationCredits({ event, createdBy })
    return { credited: issued, creditedAmount: totalAmount, creditError: null }
  } catch (creditError) {
    return { credited: 0, creditedAmount: 0, creditError }
  }
}
