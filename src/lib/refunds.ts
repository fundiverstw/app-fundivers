import { supabase } from './supabase'

// Push worker base URL (same host as the other /admin-* endpoints). Empty in
// dev so the push/inbox call is a silent no-op.
const PUSH_WORKER_URL = (import.meta.env.VITE_PUSH_WORKER_URL as string | undefined) ?? ''

// Tell the diver their refund request was approved, via the push worker (which
// writes the in-app inbox row and fans out web-push). Best-effort and
// non-blocking: a notification failure must never block the approval itself —
// the booking status write has already succeeded by the time this is called.
// No-op in dev (no worker URL) or when the admin has no session.
export async function notifyRefundApproved(bookingId: string): Promise<void> {
  if (!PUSH_WORKER_URL) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  await fetch(`${PUSH_WORKER_URL.replace(/\/$/, '')}/admin-refund-approved`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ booking_id: bookingId }),
  })
}
