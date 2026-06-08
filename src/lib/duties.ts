import { eachDayOfInterval, format } from 'date-fns'
import { supabase } from './supabase'
import type { Duty, DutyRole } from '../types/database'

// URL of the push worker's /notify-duty endpoint. Same host as /run, just
// a different pathname. Falls back to '' in dev so the call is a no-op.
const PUSH_WORKER_URL = (import.meta.env.VITE_PUSH_WORKER_URL as string | undefined) ?? ''

export interface CreateDutyInput {
  assignee_id: string
  role: DutyRole
  start_date: string
  end_date?: string | null
  eo_dive_id?: string | null
  eo_course_id?: string | null
  notes?: string | null
}

// Insert a duty row + fire an immediate push to the assignee. We do NOT block
// the insert on push delivery — if the worker is down or the assignee has no
// subscription, the duty still exists and shows up in their Duty tab.
export async function createDutyWithNotify(
  input: CreateDutyInput,
  createdBy: string,
): Promise<{ duty: Duty | null; error: Error | null }> {
  const { data, error } = await supabase
    .from('duties')
    .insert({ ...input, created_by: createdBy })
    .select()
    .single()
  if (error || !data) return { duty: null, error: error ?? new Error('insert failed') }
  notifyDutyAssigned(data.id).catch(() => { /* best-effort */ })
  return { duty: data, error: null }
}

// POST to the push worker. Surfaced as its own fn so tests can mock it and
// the create path above can fire-and-forget.
export async function notifyDutyAssigned(dutyId: string): Promise<void> {
  if (!PUSH_WORKER_URL) return
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  await fetch(`${PUSH_WORKER_URL.replace(/\/$/, '')}/notify-duty`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ duty_id: dutyId }),
  })
}

// Map of EO_dives._id / EO_courses._id → set of YYYY-MM-DD day-strings the
// current user is on duty for within the given inclusive date window. The
// admin calendar uses this to stripe the specific days the viewer is
// working — multi-day events get stripes only on the days they're on duty.
//
// Date ranges are inclusive on both ends; a null end_date is treated as a
// single-day duty on start_date. Window filter is intentionally generous —
// the returned ids are intersected with visible events, so stragglers
// harmlessly miss everything.
export async function fetchMyDutyDays(
  userId: string, from: string, to: string,
): Promise<Map<string, Set<string>>> {
  const { data, error } = await supabase
    .from('duties')
    .select('eo_dive_id, eo_course_id, start_date, end_date')
    .eq('assignee_id', userId)
    .lte('start_date', to)
    .or(`end_date.gte.${from},end_date.is.null`)
  if (error) throw error
  const out = new Map<string, Set<string>>()
  for (const row of data ?? []) {
    const days = expandDateRange(row.start_date, row.end_date)
    for (const eventId of [row.eo_dive_id, row.eo_course_id]) {
      if (!eventId) continue
      let bucket = out.get(eventId)
      if (!bucket) { bucket = new Set(); out.set(eventId, bucket) }
      for (const d of days) bucket.add(d)
    }
  }
  return out
}

// Inclusive expansion of 'YYYY-MM-DD' .. 'YYYY-MM-DD' into a list of day
// strings. Parses each side as a local date — `new Date('YYYY-MM-DD')`
// would slide by timezone.
function expandDateRange(start: string, end: string | null): string[] {
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const startD = parse(start)
  const endD = end ? parse(end) : startD
  return eachDayOfInterval({ start: startD, end: endD }).map(d => format(d, 'yyyy-MM-dd'))
}

// Soft check surfaced in the UI: every course needs at least one instructor
// per 5 non-admin divers. Returns the number of additional instructors needed
// (0 if staffed, >0 if understaffed).
export function instructorsNeeded(
  duties: Pick<Duty, 'role' | 'assignee_id'>[],
  nonAdminDiverCount: number,
): number {
  const required = Math.ceil(nonAdminDiverCount / 5)
  // Count distinct instructors — a course duty is now stored as one
  // single-day row per day, so the same instructor can hold several rows.
  const have = new Set(
    duties.filter(d => d.role === 'instructor').map(d => d.assignee_id),
  ).size
  return Math.max(0, required - have)
}
