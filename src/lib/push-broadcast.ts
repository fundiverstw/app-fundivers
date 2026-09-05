import { supabase } from './supabase'
import { t } from '../i18n'

// One-off push broadcast to every subscribed device, via the push worker's
// /admin-broadcast endpoint (which also relays to BROADCAST_WEBHOOK_URL when
// the shop has one configured).
//
// Extracted from AdminNotificationsPage when the shutdown flow grew a "tell
// your divers" step: two callers posting their own hand-rolled fetch would
// drift on the parts that matter — the bearer token, the url-only-when-filled
// rule the worker reads, and turning a non-2xx into something an admin can act
// on rather than a bare status code.

export interface BroadcastResult {
  sent:    number
  skipped: number
  webhook: boolean | null
}

export function pushWorkerUrl(): string {
  return ((import.meta.env.VITE_PUSH_WORKER_URL as string | undefined) ?? '').replace(/\/$/, '')
}

export async function sendPushBroadcast(input: {
  title: string
  body:  string
  /** Optional deep link. Omitted when blank: the worker reads an absent url as
   *  "no link", so the push opens the inbox instead of an empty page. */
  url?:  string
}): Promise<BroadcastResult> {
  const workerUrl = pushWorkerUrl()
  if (!workerUrl) throw new Error(t.admin.notifications.workerNotConfigured)

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error(t.admin.notifications.notSignedIn)

  const link = input.url?.trim()
  const res = await fetch(`${workerUrl}/admin-broadcast`, {
    method:  'POST',
    headers: {
      'content-type': 'application/json',
      authorization:  `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      title: input.title.trim(),
      body:  input.body.trim(),
      ...(link ? { url: link } : {}),
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || t.admin.notifications.broadcastFailed(res.status))
  }
  const result = await res.json() as Partial<BroadcastResult>
  return {
    sent:    result.sent ?? 0,
    skipped: result.skipped ?? 0,
    webhook: result.webhook ?? null,
  }
}
