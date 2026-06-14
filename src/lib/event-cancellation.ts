import { supabase } from './supabase'
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
