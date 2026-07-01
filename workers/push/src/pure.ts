// Pure, runtime-agnostic helpers used by the worker. Split out of
// index.ts so the tests can import them without pulling in webpush /
// @supabase/supabase-js, which are heavy and Node/Worker-only.

import type { ReminderInput, ReminderKind } from '../../../src/lib/push-reminders'

export type Booking = {
  id: string
  user_id: string
  status: string
  eo_dive_id: string | null
  eo_course_id: string | null
  details: { total?: number; deposit?: number } | null
}
export type DiveRow   = { _id: string; admin_title?: string | null; display_title?: string | null; start_date: string | null; time?: string | null }
export type CourseRow = { _id: string; admin_title?: string | null; display_title?: string | null; start_date: string | null; start_time?: string | null }

function titleOf(ev: DiveRow | CourseRow, isDive: boolean): string {
  return ev.display_title || ev.admin_title || (isDive ? 'Dive' : 'Course')
}

/** 'HH:MM:SS.SSS' / 'HH:MM:SS' / 'HH:MM' / empty → 'HH:mm' or null. */
export function toHhmm(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/**
 * Pure assembly: take the data we fetched from Supabase and turn it into
 * ReminderInput[] that selectReminders() can chew on.
 */
export function buildReminderInputs(args: {
  dives: DiveRow[]
  courses: CourseRow[]
  bookings: Booking[]
  paidByBooking: Map<string, number>
  sentMap: Map<string, Set<ReminderKind>>
  /** Shop currency label shown in the money line of a reminder. */
  currency: string
}): ReminderInput[] {
  const { dives, courses, bookings, paidByBooking, sentMap, currency } = args
  const diveMap   = new Map(dives.map((d) => [d._id, d]))
  const courseMap = new Map(courses.map((c) => [c._id, c]))

  const inputs: ReminderInput[] = []
  for (const b of bookings) {
    const isDive = !!b.eo_dive_id
    const eventId = b.eo_dive_id ?? b.eo_course_id
    if (!eventId) continue
    const ev = isDive ? diveMap.get(eventId) : courseMap.get(eventId)
    if (!ev || !ev.start_date) continue

    const details = b.details ?? {}
    const rawTime = isDive ? (ev as DiveRow).time : (ev as CourseRow).start_time
    inputs.push({
      userId:             b.user_id,
      eventId,
      eventType:          isDive ? 'dive' : 'course',
      eventTitle:         titleOf(ev, isDive),
      eventStartDate:     ev.start_date,
      eventStartTimeHhmm: toHhmm(rawTime),
      bookingStatus:      b.status,
      totalAmount:        Number(details.total   ?? 0),
      depositAmount:      Number(details.deposit ?? 0),
      paidAmount:         paidByBooking.get(b.id) ?? 0,
      currency,
      alreadySent:        sentMap.get(`${b.user_id}:${eventId}`) ?? new Set<ReminderKind>(),
    })
  }
  return inputs
}

/** Current date in the given IANA timezone, YYYY-MM-DD. */
export function todayInZone(now: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(now))
}

/** Offset a YYYY-MM-DD string by N days using UTC arithmetic. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * 'YYYY-MM-DD' → a friendly label like 'Mon, May 18'. The weekday of a
 * calendar date is timezone-independent, so we anchor at UTC midnight and
 * format in UTC — deterministic regardless of the runner's timezone, and no
 * shop-timezone assumption baked in.
 */
export function formatDayLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

/**
 * Auto-built push/inbox copy for an event schedule change. Pure so it's
 * testable without the worker runtime. When both dates are given (a
 * single-day calendar drag), the body names the move; otherwise (an edit
 * that changed dates more broadly) it gives a generic prompt to re-check.
 */
export function rescheduleNotificationText(eventTitle: string, fromKey?: string, toKey?: string): { title: string; body: string } {
  const body = fromKey && toKey
    ? `A day moved from ${formatDayLabel(fromKey)} to ${formatDayLabel(toKey)}. Check your bookings for the updated schedule.`
    : `The schedule has changed. Check your bookings for the updated dates.`
  return { title: `Schedule change: ${eventTitle}`, body }
}

/**
 * Auto-built push/inbox copy for an event cancellation. Pure so it's
 * testable without the worker runtime.
 */
export function cancellationNotificationText(eventTitle: string): { title: string; body: string } {
  return {
    title: `Cancelled: ${eventTitle}`,
    body: `${eventTitle} has been cancelled. Contact the shop if you have any questions.`,
  }
}
