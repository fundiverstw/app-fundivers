import { supabase } from './supabase'
import type { DiveLog, DiveLogInsert } from '../types/database'

const COOLDOWN_HOURS = 24

export async function fetchDiveLogs(userId: string): Promise<DiveLog[]> {
  const { data, error } = await supabase
    .from('dive_logs')
    .select('*')
    .eq('user_id', userId)
    .order('dived_on', { ascending: false })
    .order('dive_number', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function createDiveLog(row: DiveLogInsert): Promise<DiveLog> {
  // dive_number is intentionally omitted — the BEFORE INSERT trigger
  // assigns a per-user 1, 2, 3, ... so two PWA tabs editing in parallel
  // can't both compute the same number.
  const { data, error } = await supabase
    .from('dive_logs')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error
  return data!
}

export async function updateDiveLog(id: string, patch: Partial<DiveLogInsert>): Promise<DiveLog> {
  const { data, error } = await supabase
    .from('dive_logs')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data!
}

export async function deleteDiveLog(id: string): Promise<void> {
  const { error } = await supabase.from('dive_logs').delete().eq('id', id)
  if (error) throw error
}

// Look up the diver's most-recent export request so the SPA can render a
// disabled "available in N hours" state on the Email-CSV button without
// having to call the rate-limited edge function just to learn it's
// rate-limited.
export async function getLastExportRequestAt(userId: string): Promise<Date | null> {
  const { data, error } = await supabase
    .from('dive_log_export_requests')
    .select('requested_at')
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = data?.[0]
  return row ? new Date(row.requested_at) : null
}

export function nextExportAvailableAt(lastRequestedAt: Date | null): Date | null {
  if (!lastRequestedAt) return null
  const next = new Date(lastRequestedAt.getTime() + COOLDOWN_HOURS * 3600 * 1000)
  return next > new Date() ? next : null
}

export async function requestExport(): Promise<{ ok: boolean; dive_count: number }> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; dive_count: number }>(
    'request-dive-log-export',
    { body: {} },
  )
  if (error) {
    // supabase-js wraps non-2xx as FunctionsHttpError; the body lives in
    // .context. Pull it out so callers can branch on rate-limited vs other
    // errors and surface the right copy.
    const ctx = (error as { context?: unknown }).context
    if (ctx && typeof (ctx as Response).json === 'function') {
      try {
        const body = await (ctx as Response).json() as { error?: string; retry_after_seconds?: number }
        if (body?.error) throw new Error(body.error)
      } catch (e) {
        if (e instanceof Error) throw e
      }
    }
    throw new Error(error.message)
  }
  return data!
}
