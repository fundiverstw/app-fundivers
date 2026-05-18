import { supabase } from './supabase'
import type {
  StaffAvailabilityInsert, StaffAvailabilityUpdate, StaffBusyEntry,
} from '../types/database'

// All reads go through staff_availability_view so title/details are
// masked to NULL for rows the caller doesn't own. Writes still target
// the underlying table; after each write we re-fetch the masked
// projection so the caller updates its local list with a row that
// matches every other read.

export async function fetchStaffAvailabilityInRange(
  from: string, to: string,
): Promise<StaffBusyEntry[]> {
  const { data, error } = await supabase
    .from('staff_availability_view')
    .select('*')
    .lte('start_date', to)
    .gte('end_date',   from)
    .order('start_date', { ascending: true })
  if (error) throw error
  return data ?? []
}

async function fetchStaffBusyEntry(id: string): Promise<StaffBusyEntry> {
  const { data, error } = await supabase
    .from('staff_availability_view')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data!
}

export async function createStaffAvailability(row: StaffAvailabilityInsert): Promise<StaffBusyEntry> {
  const { data, error } = await supabase
    .from('staff_availability')
    .insert(row)
    .select('id')
    .single()
  if (error) throw error
  return fetchStaffBusyEntry(data!.id)
}

export async function updateStaffAvailability(
  id: string, patch: StaffAvailabilityUpdate,
): Promise<StaffBusyEntry> {
  const { error } = await supabase
    .from('staff_availability')
    .update(patch)
    .eq('id', id)
  if (error) throw error
  return fetchStaffBusyEntry(id)
}

export async function deleteStaffAvailability(id: string): Promise<void> {
  const { error } = await supabase.from('staff_availability').delete().eq('id', id)
  if (error) throw error
}
