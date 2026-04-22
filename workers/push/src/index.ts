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
  todayInTaipei,
  addDays,
  type Booking,
} from './pure'

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  VAPID_PUBLIC_KEY: string
  VAPID_PRIVATE_KEY: string
  VAPID_SUBJECT: string
  ADMIN_TRIGGER_SECRET?: string
}

type SubscriptionRow = { user_id: string; endpoint: string; p256dh: string; auth: string }

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyReminders(env))
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname !== '/run') return new Response('not found', { status: 404 })

    const auth = req.headers.get('authorization') ?? ''
    const expected = `Bearer ${env.ADMIN_TRIGGER_SECRET ?? ''}`
    if (!env.ADMIN_TRIGGER_SECRET || auth !== expected) {
      return new Response('unauthorized', { status: 401 })
    }
    const result = await runDailyReminders(env)
    return Response.json(result)
  },
}

export async function runDailyReminders(env: Env): Promise<{ sent: number; skipped: number }> {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)

  const sb = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const today = todayInTaipei()
  const WINDOWS = [1, 3, 7, 14, 21]
  const targetDates = WINDOWS.map((d) => addDays(today, d))

  const [divesResp, coursesResp] = await Promise.all([
    sb.from('EO_dives').select('_id, dive_title, title, start_date').in('start_date', targetDates),
    sb.from('EO_courses').select('_id, course_title, title, start_date').in('start_date', targetDates),
  ])
  const dives   = divesResp.data   ?? []
  const courses = coursesResp.data ?? []
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

  const inputs = buildReminderInputs({ dives, courses, bookings, paidByBooking, sentMap })
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
    if (!userSubs.length) { skipped++; continue }

    const payload = JSON.stringify({
      title: r.title,
      body:  r.body,
      tag:   `${r.eventId}:${r.kind}`,
      url:   r.url,
    })

    const deliveries = await Promise.allSettled(
      userSubs.map((s) => deliver(sb, s, payload))
    )
    const anyOk = deliveries.some((d) => d.status === 'fulfilled')
    if (anyOk) {
      sent++
      await sb.from('push_notifications_sent').upsert(
        { user_id: r.userId, event_id: r.eventId, event_type: r.eventType, kind: r.kind },
        { onConflict: 'user_id,event_id,kind' }
      )
    } else {
      skipped++
    }
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
      { TTL: 60 * 60 * 24 }
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
