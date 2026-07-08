import { supabase } from './supabase'
import { withPublishStamp } from './publish-stamp'
import type { ScheduledTrip, ScheduledTripInsert, ScheduledTripStatus } from '../types/database'

// Admin data layer for Scheduled Trips. The diver-facing read goes through the
// list_scheduled_trips() definer function in scheduled-trips.ts; this module is
// the admin CRUD against the base table (gated by the "scheduled_trips: admin
// manage" RLS policy in 20260707160000_scheduled_trips.sql).

export async function fetchAllScheduledTrips(): Promise<ScheduledTrip[]> {
  const { data, error } = await supabase
    .from('scheduled_trips')
    .select('*')
    .order('start_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as ScheduledTrip[]
}

export async function saveScheduledTrip(values: ScheduledTripInsert, existing?: ScheduledTrip): Promise<void> {
  const payload = withPublishStamp(values, existing)
  if (existing) {
    const { error } = await supabase.from('scheduled_trips').update(payload).eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('scheduled_trips').insert(payload)
    if (error) throw error
  }
}

export async function setScheduledTripStatus(trip: ScheduledTrip, status: ScheduledTripStatus): Promise<void> {
  const patch = withPublishStamp({ ...trip, status }, trip)
  const { error } = await supabase
    .from('scheduled_trips')
    .update({ status, published_at: patch.published_at ?? trip.published_at })
    .eq('id', trip.id)
  if (error) throw error
}

export async function deleteScheduledTrip(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_trips').delete().eq('id', id)
  if (error) throw error
}
