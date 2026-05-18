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

// Return the set of EO_dives._id / EO_courses._id values the current user
// has been assigned a duty for, within the given inclusive date window.
// Used by the admin calendar to tint "events I'm working" so staff/admins
// recognise their own assignments at a glance.
//
// The window filter is intentionally generous (single-day duties before
// `from` may slip in): the IDs it returns are only ever intersected with
// visible event ids, so any stragglers harmlessly miss every event.
export async function fetchMyDutyEventIds(
  userId: string, from: string, to: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('duties')
    .select('eo_dive_id, eo_course_id')
    .eq('assignee_id', userId)
    .lte('start_date', to)
    .or(`end_date.gte.${from},end_date.is.null`)
  if (error) throw error
  const out = new Set<string>()
  for (const row of data ?? []) {
    if (row.eo_dive_id)   out.add(row.eo_dive_id)
    if (row.eo_course_id) out.add(row.eo_course_id)
  }
  return out
}

// Soft check surfaced in the UI: every course needs at least one instructor
// per 5 non-admin divers. Returns the number of additional instructors needed
// (0 if staffed, >0 if understaffed).
export function instructorsNeeded(
  duties: Pick<Duty, 'role'>[],
  nonAdminDiverCount: number,
): number {
  const required = Math.ceil(nonAdminDiverCount / 5)
  const have = duties.filter(d => d.role === 'instructor').length
  return Math.max(0, required - have)
}
