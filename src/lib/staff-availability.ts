import { supabase } from './supabase'
import type {
  StaffAvailabilityInsert, StaffAvailabilityUpdate, StaffBusyEntry,
} from '../types/database'

// All reads go through staff_availability_view, which adds the owner's
// display name to each row. Only rows the caller owns (or, for an admin, any
// row) survive RLS. Writes still target the underlying table; after each write
// we re-fetch through the view so the caller updates its local list with a row
// shaped like every other read.

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

/** A profile an availability row may belong to. */
export interface AvailabilityOwner {
  id: string
  name: string | null
  nickname: string | null
}

/**
 * Everyone an admin can record availability for. Narrowed to staff + admin
 * because staff_availability_owner_role_trg rejects any other role outright,
 * so offering a diver in the picker would only produce a raw trigger error.
 */
export async function fetchAvailabilityOwners(): Promise<AvailabilityOwner[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, nickname')
    .in('role', ['admin', 'staff'])
    .order('name')
  if (error) throw error
  return data ?? []
}
