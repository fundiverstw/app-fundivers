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
export type DiveRow   = { _id: string; dive_title?: string | null;  title?: string | null; start_date: string | null }
export type CourseRow = { _id: string; course_title?: string | null; title?: string | null; start_date: string | null }

function titleOf(ev: DiveRow | CourseRow, isDive: boolean): string {
  if (isDive) {
    const d = ev as DiveRow
    return d.dive_title || d.title || 'Dive'
  }
  const c = ev as CourseRow
  return c.course_title || c.title || 'Course'
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
}): ReminderInput[] {
  const { dives, courses, bookings, paidByBooking, sentMap } = args
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
    inputs.push({
      userId:         b.user_id,
      eventId,
      eventType:      isDive ? 'dive' : 'course',
      eventTitle:     titleOf(ev, isDive),
      eventStartDate: ev.start_date,
      bookingStatus:  b.status,
      totalAmount:    Number(details.total   ?? 0),
      depositAmount:  Number(details.deposit ?? 0),
      paidAmount:     paidByBooking.get(b.id) ?? 0,
      currency:       'TWD',
      alreadySent:    sentMap.get(`${b.user_id}:${eventId}`) ?? new Set<ReminderKind>(),
    })
  }
  return inputs
}

/** Current date in Asia/Taipei (UTC+8, no DST), YYYY-MM-DD. */
export function todayInTaipei(now: number = Date.now()): string {
  const shifted = new Date(now + 8 * 3_600_000)
  return shifted.toISOString().slice(0, 10)
}

/** Offset a YYYY-MM-DD string by N days using UTC arithmetic. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
