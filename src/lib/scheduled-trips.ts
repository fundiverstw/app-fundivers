import { supabase } from './supabase'
import type { ScheduledTripItem } from '../types/database'

/**
 * The shop's published Scheduled Trips, soonest-first. Reads the
 * list_scheduled_trips() definer function, which exposes only published rows
 * and carries the linked event's kind so the card can build a register link.
 */
export async function fetchScheduledTrips(): Promise<ScheduledTripItem[]> {
  const { data, error } = await supabase
    .rpc('list_scheduled_trips')
    .order('start_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as ScheduledTripItem[]
}
