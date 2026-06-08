import { parseISO, isSameDay, format } from 'date-fns'
import { supabase } from './supabase'
import type { AppEvent } from '../types/database'

// Push worker base URL (same host as the other /admin-* endpoints).
// Empty in dev so the notify call below is a silent no-op.
const PUSH_WORKER_URL = (import.meta.env.VITE_PUSH_WORKER_URL as string | undefined) ?? ''

// Admin calendar drag-to-reschedule. Moves a SINGLE day of an event to a
// new date — courses swap one entry of their course_days list; single-day
// dives move their start/end. Multi-day dives have no discrete-day model
// (an interior day can't move without splitting the range), so they're
// not reschedulable. See MonthCalendar's onRescheduleDay drag flow.

/**
 * Whether an event supports the one-day drag-to-reschedule gesture.
 * Courses always do (every calendar cell is one course_days entry).
 * Dives only when single-day — no end date, or an end on the same
 * calendar day as the start.
 */
export function isReschedulable(ev: Pick<AppEvent, 'type' | 'start_time' | 'end_time'>): boolean {
  if (ev.type === 'course') return true
  if (!ev.end_time) return true
  return isSameDay(parseISO(ev.start_time), parseISO(ev.end_time))
}

/** YYYY-MM-DD date keys → simple comparable form. */
function toDateKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  return s ? s.slice(0, 10) : null
}

/**
 * Replace `from` with `to` in a day list, then dedupe + sort. Pure.
 * If `from` isn't present the list is returned unchanged (deduped/sorted).
 */
export function replaceDayInList(days: string[], from: string, to: string): string[] {
  const next = days.map(d => (d === from ? to : d))
  return [...new Set(next.filter(Boolean))].sort()
}

/**
 * Persist a one-day move. `fromKey`/`toKey` are 'YYYY-MM-DD'. No-op when
 * the day didn't actually move. Throws on a DB error so the caller can
 * surface it (the admin RLS is_admin() policy gates the write).
 */
export async function rescheduleEventDay(ev: AppEvent, fromKey: string, toKey: string): Promise<void> {
  if (!fromKey || !toKey || fromKey === toKey) return

  if (ev.type === 'course') {
    const { data, error } = await supabase
      .from('EO_courses')
      .select('course_days')
      .eq('_id', ev.id)
      .single()
    if (error) throw error
    const current = ((data as { course_days: string[] | null } | null)?.course_days ?? [])
      .map(toDateKey)
      .filter((k): k is string => !!k)
    if (!current.includes(fromKey)) return
    const days = replaceDayInList(current, fromKey, toKey)
    const { error: updErr } = await supabase
      .from('EO_courses')
      .update({ course_days: days } as never)
      .eq('_id', ev.id)
    if (updErr) throw updErr
    return
  }

  // Single-day dive: move start_date, and end_date too when it mirrors the
  // start (so a one-day dive stays one day). time is left untouched.
  // start_time/end_time are UTC ISO; derive the LOCAL day key so it lines
  // up with the calendar cell's date (which is local) rather than slicing
  // the UTC string, which shifts a day on UTC+8.
  const startKey = format(parseISO(ev.start_time), 'yyyy-MM-dd')
  if (startKey !== fromKey) return
  const endKey = ev.end_time ? format(parseISO(ev.end_time), 'yyyy-MM-dd') : null
  const patch: Record<string, string> = { start_date: toKey }
  if (endKey === null || endKey === startKey) patch.end_date = toKey
  const { error } = await supabase
    .from('EO_dives')
    .update(patch as never)
    .eq('_id', ev.id)
  if (error) throw error
}

// Fire-and-forget POST to the push worker, which notifies every
// non-cancelled registrant (push + in-app inbox row). Best-effort: no
// worker URL or no session → silent no-op, so a push failure never blocks
// the date change itself. Mirrors notifyDutyAssigned in src/lib/duties.ts.
async function postScheduleChange(
  eventId: string, eventType: AppEvent['type'], fromKey?: string, toKey?: string,
): Promise<void> {
  if (!PUSH_WORKER_URL) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  const payload: Record<string, string> = { event_id: eventId, event_type: eventType }
  if (fromKey && toKey) { payload.from_date = fromKey; payload.to_date = toKey }
  await fetch(`${PUSH_WORKER_URL.replace(/\/$/, '')}/admin-event-reschedule`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  })
}

/**
 * Notify registrants that one specific day of an event moved (the calendar
 * drag-to-reschedule flow). Produces the "a day moved from X to Y" message.
 */
export async function notifyEventRescheduled(
  eventId: string, eventType: AppEvent['type'], fromKey: string, toKey: string,
): Promise<void> {
  if (fromKey === toKey) return
  await postScheduleChange(eventId, eventType, fromKey, toKey)
}

/**
 * Notify registrants that an event's dates changed in a way that isn't a
 * single-day move (the admin edit form). Produces the generic "the schedule
 * has changed" message.
 */
export async function notifyEventScheduleChanged(eventId: string, eventType: AppEvent['type']): Promise<void> {
  await postScheduleChange(eventId, eventType)
}
