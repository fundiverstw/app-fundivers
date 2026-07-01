// Cloudflare Worker: daily push-notification sender.
//
// Runs on the cron defined in wrangler.toml. Each tick:
//   1. Collects bookings for events that start at any of the reminder windows
//      (1/3/7/14/21 days from today, Asia/Taipei).
//   2. Computes outstanding deposit/balance per booking from payments ledger.
//   3. Runs selectReminders() — pure logic shared with the main app.
//   4. Sends each reminder via web-push to every device the recipient has
//      subscribed, removing dead endpoints (404/410).
//   5. Records a row in push_notifications_sent so reruns are idempotent.
//
// A `fetch` handler is included for manual-trigger smoke tests during rollout;
// it's authorized via a one-off `ADMIN_TRIGGER_SECRET` worker secret.

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import {
  selectReminders,
  type ReminderKind,
} from '../../../src/lib/push-reminders'
import type { Database } from '../../../src/types/database'
import {
  buildReminderInputs,
  todayInZone,
  addDays,
  toHhmm,
  rescheduleNotificationText,
  cancellationNotificationText,
  type Booking,
} from './pure'

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  SUPABASE_ANON_KEY?: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  // Comma-separated list of browser origins allowed to call this worker (the
  // fork's app domain). The local dev origin is always allowed. CORS is UX-only
  // here — every handler still enforces auth via the Bearer JWT.
  ALLOWED_ORIGINS?: string
  // IANA timezone the shop operates in (e.g. "Asia/Taipei"). Controls the
  // "today" boundary for daily reminders and the human times in offer emails.
  TIMEZONE?: string
  // Currency label shown in the money line of payment reminders (e.g. "TWD").
  CURRENCY?: string
  ADMIN_TRIGGER_SECRET?: string
  // Optional: when set, /admin-broadcast also POSTs `{title, body}` JSON to
  // this URL (e.g. a LINE Messaging API relay or a third-party automation).
  BROADCAST_WEBHOOK_URL?: string
}

type SubscriptionRow = { user_id: string; endpoint: string; p256dh: string; auth: string }

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    // Waitlist processing runs on every cron tick — it's idempotent
    // (notified_at gates double-sends, status='pending' gates double-expires)
    // so re-running is a no-op once the per-tick set has been processed.
    ctx.waitUntil(processWaitlistOffers(env))
    // The daily reminder fan-out is heavy and time-sensitive — only on the
    // 02:00 UTC = 10:00 Asia/Taipei tick.
    if (event.cron === '0 2 * * *') {
      ctx.waitUntil(runDailyReminders(env))
    }
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) })
    }
    if (url.pathname === '/run') {
      const auth = req.headers.get('authorization') ?? ''
      const expected = `Bearer ${env.ADMIN_TRIGGER_SECRET ?? ''}`
      if (!env.ADMIN_TRIGGER_SECRET || auth !== expected) {
        return withCors(new Response('unauthorized', { status: 401 }), req, env)
      }
      const result = await runDailyReminders(env)
      return withCors(Response.json(result), req, env)
    }
    if (url.pathname === '/process-waitlist-offers') {
      const auth = req.headers.get('authorization') ?? ''
      const expected = `Bearer ${env.ADMIN_TRIGGER_SECRET ?? ''}`
      if (!env.ADMIN_TRIGGER_SECRET || auth !== expected) {
        return withCors(new Response('unauthorized', { status: 401 }), req, env)
      }
      const result = await processWaitlistOffers(env)
      return withCors(Response.json(result), req, env)
    }
    if (url.pathname === '/notify-duty' && req.method === 'POST') {
      return withCors(await handleNotifyDuty(req, env), req, env)
    }
    if (url.pathname === '/admin-broadcast' && req.method === 'POST') {
      return withCors(await handleAdminBroadcast(req, env), req, env)
    }
    if (url.pathname === '/admin-event-broadcast' && req.method === 'POST') {
      return withCors(await handleAdminEventBroadcast(req, env), req, env)
    }
    if (url.pathname === '/admin-event-reschedule' && req.method === 'POST') {
      return withCors(await handleAdminEventReschedule(req, env), req, env)
    }
    if (url.pathname === '/admin-event-cancellation' && req.method === 'POST') {
      return withCors(await handleAdminEventCancellation(req, env), req, env)
    }
    return withCors(new Response('not found', { status: 404 }), req, env)
  },
}

// Browser callers (the SPA) hit this worker cross-origin and send an
// Authorization header, which forces a CORS preflight. Only the SPA origins
// are allowlisted; other origins get no Access-Control-Allow-Origin and are
// blocked by the browser. CORS is browser-side only — auth is still enforced
// per-handler via the Bearer JWT, so this list is about UX, not security.
// Production origin(s) come from the ALLOWED_ORIGINS env var (comma-separated)
// so each fork sets its own app domain in wrangler.toml. The local dev origin is
// always allowed so `make dev` can reach the worker.
function allowedOrigins(env: Env): Set<string> {
  const configured = (env.ALLOWED_ORIGINS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
  return new Set([...configured, 'http://localhost:5173'])
}

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  if (!allowedOrigins(env).has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function withCors(res: Response, req: Request, env: Env): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(corsHeaders(req, env))) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

// Fires a push to the assignee the moment a duty row is inserted — out-of-band
// from the daily reminder cron so the admin sees it immediately, not 24h later.
//
// Auth model: the caller passes their user JWT. We do an admin gate via a
// user-scoped Supabase client (RLS on duties enforces admin-only), then use
// the service role client to look up push subscriptions and send.
export async function handleNotifyDuty(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })

  let body: { duty_id?: string }
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
  const dutyId = body.duty_id
  if (!dutyId) return new Response('missing duty_id', { status: 400 })

  const anonKey = (env as Env & { SUPABASE_ANON_KEY?: string }).SUPABASE_ANON_KEY
  if (!anonKey) return new Response('SUPABASE_ANON_KEY not configured', { status: 500 })

  // RLS on duties requires admin role; if the caller isn't admin this read
  // returns no rows and we bail.
  const userClient = createClient<Database>(env.SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: duty } = await userClient
    .from('duties')
    .select('id, assignee_id, role, start_date, end_date, eo_dive_id, eo_course_id')
    .eq('id', dutyId)
    .maybeSingle()
  if (!duty) return new Response('not found', { status: 404 })

  const service = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Resolve event title (best-effort; no event = standalone duty, push still goes out).
  let eventTitle: string | null = null
  let eventTimeHhmm: string | null = null
  if (duty.eo_dive_id) {
    const { data } = await service.from('EO_dives').select('admin_title, display_title, time').eq('_id', duty.eo_dive_id).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || null
    eventTimeHhmm = toHhmm(data?.time)
  } else if (duty.eo_course_id) {
    const { data } = await service.from('EO_courses').select('display_title, admin_title, start_time').eq('_id', duty.eo_course_id).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || null
    eventTimeHhmm = toHhmm(data?.start_time)
  }

  const { data: subs } = await service
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', duty.assignee_id)
  if (!subs?.length) return Response.json({ sent: 0, skipped: 1, reason: 'no-subscription' })

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  const dateSpan = duty.end_date && duty.end_date !== duty.start_date
    ? `${duty.start_date} → ${duty.end_date}`
    : duty.start_date
  const titlePart = eventTitle ? ` for ${eventTitle}` : ''
  const timePart = eventTimeHhmm ? ` · ${eventTimeHhmm}` : ''
  const dutyTitle = 'New duty assigned'
  const dutyBody  = `${capitalize(duty.role)}${titlePart} · ${dateSpan}${timePart}`
  const dutyUrl   = '/admin/duty'
  const payload = JSON.stringify({
    title: dutyTitle,
    body:  dutyBody,
    tag:   `duty:${duty.id}`,
    url:   dutyUrl,
  })

  // Inbox row for the assignee — same content as the push payload. Goes
  // out before the push fan-out so even if every endpoint 410s the row
  // is still in the inbox.
  await service.from('notifications').insert({
    user_id:  duty.assignee_id,
    title:    dutyTitle,
    body:     dutyBody,
    url:      dutyUrl,
    kind:     'duty',
    event_id: duty.eo_dive_id ?? duty.eo_course_id ?? null,
  })

  let sent = 0
  let skipped = 0
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: 'high' }
      )
      sent++
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) {
        await service.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      }
      skipped++
    }
  }
  return Response.json({ sent, skipped })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Admin one-off broadcast: send a custom title+body to every device that
// has opted in via push_subscriptions. Used for ad-hoc announcements and
// for debugging the push pipeline end-to-end (the original motivation —
// it's hard to tell whether a quiet day means "no reminders due today"
// or "the worker is broken"). Optionally relays the same title+body to
// BROADCAST_WEBHOOK_URL so a LINE / Slack / etc. integration can receive
// the same payload.
export async function handleAdminBroadcast(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const token = auth.slice('Bearer '.length)

  let body: { title?: string; body?: string; url?: string }
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
  // Audit L13 — cap admin-supplied lengths before fan-out. Both the
  // OS push surface and the BROADCAST_WEBHOOK_URL forwarder receive
  // the same string; bounding here keeps a misclick from blowing up
  // downstream surfaces (and keeps the push payload under the 4KB
  // VAPID body limit).
  const MAX_TITLE_LEN = 120
  const MAX_BODY_LEN  = 500
  const title = (body.title ?? '').trim().slice(0, MAX_TITLE_LEN)
  const text  = (body.body  ?? '').trim().slice(0, MAX_BODY_LEN)
  // Two URLs derived from one optional admin input:
  //   • pushUrl     — where tapping the OS notification opens the app.
  //                    Falls back to /notifications (the inbox) so the
  //                    diver can re-read the body on tap; landing on a
  //                    catch-all redirect to /calendar made the message
  //                    feel "lost" the moment the system tray dismissed it.
  //   • inboxUrl    — what the inbox row stores. NULL when the admin
  //                    didn't set a link, so the row doesn't render an
  //                    "Open link" CTA pointing at the inbox itself.
  const adminLink = (body.url ?? '').trim()
  const pushUrl   = adminLink || '/notifications'
  const inboxUrl  = adminLink || null
  if (!title || !text) return new Response('title and body are required', { status: 400 })

  const anonKey = env.SUPABASE_ANON_KEY
  if (!anonKey) return new Response('SUPABASE_ANON_KEY not configured', { status: 500 })

  // Admin gate: profiles RLS lets users read their own row, so we read
  // the caller's profile via their JWT and reject anyone whose role isn't
  // 'admin'. profiles.role is the source of truth elsewhere in the app.
  const userClient = createClient<Database>(env.SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  // Pass the JWT explicitly — getUser() with no arg returns null in worker
  // contexts where no session is persisted, even when global.headers carries
  // the Authorization. Explicit form hits /auth/v1/user with the token directly.
  const { data: userRes, error: userErr } = await userClient.auth.getUser(token)
  const userId = userRes?.user?.id
  if (!userId) {
    console.error('admin-broadcast: getUser failed', userErr?.message ?? 'no user')
    return new Response('unauthorized', { status: 401 })
  }
  const { data: prof } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (prof?.role !== 'admin') return new Response('forbidden', { status: 403 })

  const service = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  const { data: subs } = await service
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  const payload = JSON.stringify({ title, body: text, tag: `broadcast:${Date.now()}`, url: pushUrl })

  let sent = 0
  let skipped = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: 'high' }
      )
      sent++
    } catch (err: unknown) {
      const status = (err as { statusCode?: number })?.statusCode
      if (status === 404 || status === 410) {
        await service.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      }
      skipped++
    }
  }

  // Inbox fan-out — one row per active diver, regardless of whether they
  // have a push subscription. This is the only delivery mechanism for
  // iOS users who haven't installed the PWA, and it keeps a scrollable
  // history of past broadcasts for everyone else.
  const { data: recipients } = await service
    .from('profiles')
    .select('id')
    .eq('status', 'active')
  if (recipients?.length) {
    const rows = recipients.map((p) => ({
      user_id: p.id,
      title,
      body: text,
      url: inboxUrl,
      kind: 'broadcast' as const,
      event_id: null,
    }))
    await service.from('notifications').insert(rows)
  }

  // Fire-and-forget webhook relay. Failure here does not fail the request —
  // the push fan-out is the primary channel and we don't want a flaky
  // third-party endpoint to mask a successful broadcast.
  let webhookOk: boolean | null = null
  if (env.BROADCAST_WEBHOOK_URL) {
    try {
      const res = await fetch(env.BROADCAST_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, body: text }),
      })
      webhookOk = res.ok
    } catch {
      webhookOk = false
    }
  }

  return Response.json({ sent, skipped, webhook: webhookOk })
}

// Admin-triggered status push for a single event ("ON AS SCHEDULED" /
// "CANCELLED"). Goes only to confirmed bookings on the event so we don't
// alarm cancelled/waitlisted divers. Title is built from the toggle and
// the event's display_title; the admin-supplied note becomes the body.
//
// Tap target is /notifications (the inbox) — tapping a system push that
// vanishes from the tray is the worst time to lose the message body, and
// the inbox row keeps the full text scrollable.
export async function handleAdminEventBroadcast(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const token = auth.slice('Bearer '.length)

  let body: { event_id?: string; event_type?: 'dive' | 'course'; status?: 'on' | 'cancelled'; body?: string }
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
  const eventId   = (body.event_id ?? '').trim()
  const eventType = body.event_type
  const status    = body.status
  const text      = (body.body ?? '').trim()
  if (!eventId)                                  return new Response('event_id is required', { status: 400 })
  if (eventType !== 'dive' && eventType !== 'course') return new Response('event_type must be dive or course', { status: 400 })
  if (status !== 'on' && status !== 'cancelled')      return new Response('status must be on or cancelled', { status: 400 })
  if (!text)                                          return new Response('body is required', { status: 400 })

  const anonKey = env.SUPABASE_ANON_KEY
  if (!anonKey) return new Response('SUPABASE_ANON_KEY not configured', { status: 500 })

  // Admin gate via the caller's JWT — same pattern as handleAdminBroadcast.
  const userClient = createClient<Database>(env.SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userRes } = await userClient.auth.getUser(token)
  const userId = userRes?.user?.id
  if (!userId) return new Response('unauthorized', { status: 401 })
  const { data: prof } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (prof?.role !== 'admin') return new Response('forbidden', { status: 403 })

  const service = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Resolve event title.
  let eventTitle = 'Event'
  if (eventType === 'dive') {
    const { data } = await service.from('EO_dives').select('display_title, admin_title').eq('_id', eventId).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || eventTitle
  } else {
    const { data } = await service.from('EO_courses').select('display_title, admin_title').eq('_id', eventId).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || eventTitle
  }

  const title = status === 'on'
    ? `Event ${eventTitle} is ON AS SCHEDULED!`
    : `Event ${eventTitle} is CANCELLED :(`

  // Confirmed bookings only — pending/waitlisted/cancelled divers don't
  // get the message.
  const column = eventType === 'dive' ? 'eo_dive_id' : 'eo_course_id'
  const { data: bookings } = await service
    .from('bookings')
    .select('user_id')
    .eq(column, eventId)
    .eq('status', 'confirmed')
  const recipientIds = unique((bookings ?? []).map(b => b.user_id))
  if (!recipientIds.length) return Response.json({ sent: 0, skipped: 0, recipients: 0 })

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

  // Inbox row per recipient first — sole delivery path for users without
  // push subscriptions.
  const inboxRows = recipientIds.map(uid => ({
    user_id:  uid,
    title,
    body:     text,
    url:      '/notifications',
    kind:     'event_status' as const,
    event_id: eventId,
  }))
  await service.from('notifications').insert(inboxRows)

  const { data: subs } = await service
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', recipientIds)

  const payload = JSON.stringify({
    title,
    body: text,
    tag:  `event-status:${eventId}:${Date.now()}`,
    url:  '/notifications',
  })

  let sent = 0
  let skipped = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: 'high' }
      )
      sent++
    } catch (err: unknown) {
      const sc = (err as { statusCode?: number })?.statusCode
      if (sc === 404 || sc === 410) {
        await service.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      }
      skipped++
    }
  }
  return Response.json({ sent, skipped, recipients: recipientIds.length })
}

// Auto-notify every non-cancelled registrant when an admin moves one day
// of an event (the calendar drag-to-reschedule flow). Mirrors
// handleAdminEventBroadcast, but the title/body are auto-built from the
// from/to dates and recipients include pending + waitlisted bookings, not
// just confirmed — anyone holding a spot needs to know the date moved.
export async function handleAdminEventReschedule(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const token = auth.slice('Bearer '.length)

  let body: { event_id?: string; event_type?: 'dive' | 'course'; from_date?: string; to_date?: string }
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
  const eventId   = (body.event_id ?? '').trim()
  const eventType = body.event_type
  const fromDate  = (body.from_date ?? '').trim()
  const toDate    = (body.to_date ?? '').trim()
  if (!eventId)                                       return new Response('event_id is required', { status: 400 })
  if (eventType !== 'dive' && eventType !== 'course') return new Response('event_type must be dive or course', { status: 400 })
  // from_date/to_date are optional: a single-day calendar drag sends both
  // (specific message); an edit that changed dates more broadly sends
  // neither (generic message). A no-op move (both present and equal) sends
  // nothing.
  if (fromDate && toDate && fromDate === toDate)      return Response.json({ sent: 0, skipped: 0, recipients: 0 })

  const anonKey = env.SUPABASE_ANON_KEY
  if (!anonKey) return new Response('SUPABASE_ANON_KEY not configured', { status: 500 })

  // Admin gate via the caller's JWT — same pattern as handleAdminEventBroadcast.
  const userClient = createClient<Database>(env.SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userRes } = await userClient.auth.getUser(token)
  const userId = userRes?.user?.id
  if (!userId) return new Response('unauthorized', { status: 401 })
  const { data: prof } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (prof?.role !== 'admin') return new Response('forbidden', { status: 403 })

  const service = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // Resolve event title.
  let eventTitle = 'Event'
  if (eventType === 'dive') {
    const { data } = await service.from('EO_dives').select('display_title, admin_title').eq('_id', eventId).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || eventTitle
  } else {
    const { data } = await service.from('EO_courses').select('display_title, admin_title').eq('_id', eventId).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || eventTitle
  }

  const { title, body: text } = rescheduleNotificationText(eventTitle, fromDate || undefined, toDate || undefined)

  // Every non-cancelled registrant — pending/waitlisted included, since
  // they're holding a spot and need to know the date moved.
  const column = eventType === 'dive' ? 'eo_dive_id' : 'eo_course_id'
  const { data: bookings } = await service
    .from('bookings')
    .select('user_id')
    .eq(column, eventId)
    .neq('status', 'cancelled')
  const recipientIds = unique((bookings ?? []).map(b => b.user_id))
  if (!recipientIds.length) return Response.json({ sent: 0, skipped: 0, recipients: 0 })

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

  // Inbox row per recipient first — sole delivery path for users without
  // push subscriptions.
  const inboxRows = recipientIds.map(uid => ({
    user_id:  uid,
    title,
    body:     text,
    url:      '/notifications',
    kind:     'event_reschedule' as const,
    event_id: eventId,
  }))
  await service.from('notifications').insert(inboxRows)

  const { data: subs } = await service
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', recipientIds)

  const payload = JSON.stringify({
    title,
    body: text,
    tag:  `event-reschedule:${eventId}:${Date.now()}`,
    url:  '/notifications',
  })

  let sent = 0
  let skipped = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: 'high' }
      )
      sent++
    } catch (err: unknown) {
      const sc = (err as { statusCode?: number })?.statusCode
      if (sc === 404 || sc === 410) {
        await service.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      }
      skipped++
    }
  }
  return Response.json({ sent, skipped, recipients: recipientIds.length })
}

// Push + in-app inbox for an event cancellation. Mirrors
// handleAdminEventReschedule: admin-gated, every non-cancelled registrant
// (pending/waitlisted included), inbox row first then push fan-out. The
// matching cancellation EMAIL is sent separately by the
// notify-event-cancellation edge function (the worker can't run SMTP).
export async function handleAdminEventCancellation(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return new Response('unauthorized', { status: 401 })
  const token = auth.slice('Bearer '.length)

  let body: { event_id?: string; event_type?: 'dive' | 'course' }
  try { body = await req.json() } catch { return new Response('bad request', { status: 400 }) }
  const eventId   = (body.event_id ?? '').trim()
  const eventType = body.event_type
  if (!eventId)                                       return new Response('event_id is required', { status: 400 })
  if (eventType !== 'dive' && eventType !== 'course') return new Response('event_type must be dive or course', { status: 400 })

  const anonKey = env.SUPABASE_ANON_KEY
  if (!anonKey) return new Response('SUPABASE_ANON_KEY not configured', { status: 500 })

  const userClient = createClient<Database>(env.SUPABASE_URL, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userRes } = await userClient.auth.getUser(token)
  const userId = userRes?.user?.id
  if (!userId) return new Response('unauthorized', { status: 401 })
  const { data: prof } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  if (prof?.role !== 'admin') return new Response('forbidden', { status: 403 })

  const service = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  let eventTitle = 'Event'
  if (eventType === 'dive') {
    const { data } = await service.from('EO_dives').select('display_title, admin_title').eq('_id', eventId).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || eventTitle
  } else {
    const { data } = await service.from('EO_courses').select('display_title, admin_title').eq('_id', eventId).maybeSingle()
    eventTitle = data?.display_title || data?.admin_title || eventTitle
  }

  const { title, body: text } = cancellationNotificationText(eventTitle)

  const column = eventType === 'dive' ? 'eo_dive_id' : 'eo_course_id'
  const { data: bookings } = await service
    .from('bookings')
    .select('user_id')
    .eq(column, eventId)
    .neq('status', 'cancelled')
  const recipientIds = unique((bookings ?? []).map(b => b.user_id))
  if (!recipientIds.length) return Response.json({ sent: 0, skipped: 0, recipients: 0 })

  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

  const inboxRows = recipientIds.map(uid => ({
    user_id:  uid,
    title,
    body:     text,
    url:      '/notifications',
    kind:     'event_cancellation' as const,
    event_id: eventId,
  }))
  await service.from('notifications').insert(inboxRows)

  const { data: subs } = await service
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', recipientIds)

  const payload = JSON.stringify({
    title,
    body: text,
    tag:  `event-cancellation:${eventId}:${Date.now()}`,
    url:  '/notifications',
  })

  let sent = 0
  let skipped = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: 'high' }
      )
      sent++
    } catch (err: unknown) {
      const sc = (err as { statusCode?: number })?.statusCode
      if (sc === 404 || sc === 410) {
        await service.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
      }
      skipped++
    }
  }
  return Response.json({ sent, skipped, recipients: recipientIds.length })
}

export async function runDailyReminders(env: Env): Promise<{ sent: number; skipped: number }> {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

  const sb = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const today = todayInZone(Date.now(), env.TIMEZONE ?? 'Asia/Taipei')
  const WINDOWS = [1, 3, 7, 14, 21]
  const targetDates = WINDOWS.map((d) => addDays(today, d))

  const targetSet = new Set(targetDates)
  const [divesResp, coursesResp] = await Promise.all([
    sb.from('EO_dives').select('_id, admin_title, display_title, start_date, time').in('start_date', targetDates).is('cancelled_at', null),
    // Courses have no start_date — fetch any course with a day on a target
    // date, then anchor the reminder to its first day so behavior matches
    // the old start_date-keyed reminder (one reminder, before day 1).
    sb.from('EO_courses').select('_id, admin_title, display_title, course_days, start_time').overlaps('course_days', targetDates).is('cancelled_at', null),
  ])
  const dives   = divesResp.data   ?? []
  const courses = (coursesResp.data ?? [])
    .map((c) => ({ ...c, start_date: [...((c.course_days as string[] | null) ?? [])].sort()[0] ?? null }))
    .filter((c) => c.start_date && targetSet.has(c.start_date))
  if (!dives.length && !courses.length) return { sent: 0, skipped: 0 }

  const diveIds   = dives.map((d) => d._id)
  const courseIds = courses.map((c) => c._id)

  // Two explicit queries rather than a PostgREST `.or()` string.
  const [diveBookingsResp, courseBookingsResp] = await Promise.all([
    diveIds.length
      ? sb.from('bookings').select('id, user_id, status, eo_dive_id, eo_course_id, details').in('eo_dive_id', diveIds)
      : Promise.resolve({ data: [] as Booking[] }),
    courseIds.length
      ? sb.from('bookings').select('id, user_id, status, eo_dive_id, eo_course_id, details').in('eo_course_id', courseIds)
      : Promise.resolve({ data: [] as Booking[] }),
  ])
  const bookings: Booking[] = [...(diveBookingsResp.data ?? []), ...(courseBookingsResp.data ?? [])]
  if (!bookings.length) return { sent: 0, skipped: 0 }

  // Paid totals per booking.
  const bookingIds = bookings.map((b) => b.id)
  const { data: payments } = await sb
    .from('payments')
    .select('booking_id, amount, status')
    .in('booking_id', bookingIds)

  const paidByBooking = new Map<string, number>()
  for (const p of payments ?? []) {
    if (p.status !== 'paid' || !p.booking_id) continue
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + Number(p.amount))
  }

  // Idempotency ledger for this slice of (user, event).
  const uniqUserIds  = unique(bookings.map((b) => b.user_id))
  const uniqEventIds = unique(bookings.map((b) => b.eo_dive_id ?? b.eo_course_id ?? ''))
  const { data: sentRows } = await sb
    .from('push_notifications_sent')
    .select('user_id, event_id, kind')
    .in('user_id', uniqUserIds)
    .in('event_id', uniqEventIds)

  const sentMap = new Map<string, Set<ReminderKind>>()
  for (const s of sentRows ?? []) {
    const key = `${s.user_id}:${s.event_id}`
    const set = sentMap.get(key) ?? new Set<ReminderKind>()
    set.add(s.kind as ReminderKind)
    sentMap.set(key, set)
  }

  const inputs = buildReminderInputs({ dives, courses, bookings, paidByBooking, sentMap, currency: env.CURRENCY ?? 'TWD' })
  const reminders = selectReminders(today, inputs)
  if (!reminders.length) return { sent: 0, skipped: 0 }

  // Fan out to every subscription each recipient has.
  const recipientIds = unique(reminders.map((r) => r.userId))
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('user_id, endpoint, p256dh, auth')
    .in('user_id', recipientIds)

  const subsByUser = new Map<string, SubscriptionRow[]>()
  for (const s of subs ?? []) {
    const list = subsByUser.get(s.user_id) ?? []
    list.push(s)
    subsByUser.set(s.user_id, list)
  }

  let sent = 0
  let skipped = 0
  for (const r of reminders) {
    const userSubs = subsByUser.get(r.userId) ?? []
    let anyOk = false
    if (userSubs.length) {
      const payload = JSON.stringify({
        title: r.title,
        body:  r.body,
        tag:   `${r.eventId}:${r.kind}`,
        url:   r.url,
      })
      const deliveries = await Promise.allSettled(
        userSubs.map((s) => deliver(sb, s, payload))
      )
      anyOk = deliveries.some((d) => d.status === 'fulfilled')
    }

    // Persist the in-app inbox row regardless of push outcome — covers
    // recipients with no push subscriptions (iOS not added to Home Screen)
    // and lets us record history we can scroll through later. The
    // push_notifications_sent upsert below dedupes against future cron
    // runs, so we don't insert duplicates.
    await sb.from('notifications').insert({
      user_id:  r.userId,
      title:    r.title,
      body:     r.body,
      url:      r.url,
      kind:     'reminder',
      event_id: r.eventId,
    })
    await sb.from('push_notifications_sent').upsert(
      { user_id: r.userId, event_id: r.eventId, event_type: r.eventType, kind: r.kind },
      { onConflict: 'user_id,event_id,kind' }
    )
    if (anyOk) sent++
    else skipped++
  }

  return { sent, skipped }
}

async function deliver(
  sb: ReturnType<typeof createClient<Database>>,
  sub: SubscriptionRow,
  payload: string
): Promise<void> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 60 * 60 * 24, urgency: 'high' }
    )
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 404 || status === 410) {
      // Endpoint is permanently gone — clean up so we don't keep trying.
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
    }
    throw err
  }
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)]
}


// Waitlist-offer processing pass — runs every 15 min via the second cron
// declared in wrangler.toml.
//
// Two passes per tick:
//   1. Newly-created offers (notified_at IS NULL): send the push and the
//      email, write the inbox row, then stamp notified_at so the next
//      tick doesn't duplicate.
//   2. Stale offers (expires_at < now): mark expired, then call the SQL
//      helper to issue a fresh offer for the next waitlister on that
//      same event. Chains organically tick-by-tick — if the next person
//      also lets it expire, the tick after rolls again.
//
// Email sending is delegated to the `notify-waitlist-offer` edge function
// (Cloudflare Workers can't talk SMTP). Push is sent directly here since
// the worker already owns webpush + the VAPID keys.
export async function processWaitlistOffers(env: Env): Promise<{ sent: number; expired: number }> {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

  const sb = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data: offers } = await sb
    .from('waitlist_offers')
    .select('id, booking_id, expires_at, notified_at, status')
    .eq('status', 'pending')

  if (!offers?.length) return { sent: 0, expired: 0 }

  const nowIso = new Date().toISOString()
  let sent = 0
  let expired = 0

  for (const offer of offers) {
    if (new Date(offer.expires_at) < new Date(nowIso)) {
      await sb.from('waitlist_offers').update({ status: 'expired' }).eq('id', offer.id)

      const { data: b } = await sb
        .from('bookings')
        .select('eo_dive_id, eo_course_id')
        .eq('id', offer.booking_id)
        .maybeSingle()
      if (b) {
        const eventId = b.eo_dive_id ?? b.eo_course_id
        const eventType = b.eo_dive_id ? 'dive' : 'course'
        if (eventId) {
          // Fire-and-forget; failure here just means no chain — the next
          // upstream cancellation will offer the spot anew.
          await sb.rpc('offer_next_waitlist_spot', { p_event_id: eventId, p_event_type: eventType })
        }
      }
      expired++
      continue
    }

    if (offer.notified_at) continue

    const { data: booking } = await sb
      .from('bookings')
      .select('user_id, eo_dive_id, eo_course_id')
      .eq('id', offer.booking_id)
      .maybeSingle()
    if (!booking) continue

    let eventTitle = 'Event'
    const eventId = booking.eo_dive_id ?? booking.eo_course_id
    if (booking.eo_dive_id) {
      const { data } = await sb.from('EO_dives')
        .select('display_title, admin_title').eq('_id', booking.eo_dive_id).maybeSingle()
      eventTitle = (data?.display_title ?? data?.admin_title ?? eventTitle) as string
    } else if (booking.eo_course_id) {
      const { data } = await sb.from('EO_courses')
        .select('display_title, admin_title').eq('_id', booking.eo_course_id).maybeSingle()
      eventTitle = (data?.display_title ?? data?.admin_title ?? eventTitle) as string
    }

    const tz = env.TIMEZONE ?? 'Asia/Taipei'
    const expiresLabel = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(new Date(offer.expires_at))

    const title = 'Spot opened on the waitlist'
    const body  = `${eventTitle} — accept by ${expiresLabel} (${tz}) before it rolls to the next person.`
    const url   = '/records/bookings'

    // Inbox first — the only delivery path for iOS / no-push users.
    await sb.from('notifications').insert({
      user_id:  booking.user_id,
      title, body, url,
      kind:     'waitlist_offer',
      event_id: eventId ?? null,
    })

    // Push fan-out across every endpoint the recipient has.
    const { data: subs } = await sb
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', booking.user_id)
    if (subs?.length) {
      const payload = JSON.stringify({ title, body, tag: `waitlist:${offer.id}`, url })
      for (const s of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            { TTL: 60 * 60 * 24, urgency: 'high' }
          )
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode
          if (status === 404 || status === 410) {
            await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
          }
        }
      }
    }

    // Email via the edge function. The function checks the bearer matches
    // SERVICE_ROLE_KEY before sending, so only the worker can call it.
    await sb.functions.invoke('notify-waitlist-offer', { body: { offer_id: offer.id } })

    await sb.from('waitlist_offers').update({ notified_at: nowIso }).eq('id', offer.id)
    sent++
  }

  return { sent, expired }
}
