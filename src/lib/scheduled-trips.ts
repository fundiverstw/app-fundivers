import { supabase } from './supabase'
import type { ScheduledTripItem, MyScheduledTripRegistration } from '../types/database'

export interface RegisterForScheduledTripInput {
  scheduledTripId: string
  addonIds: string[]
  roomId: string | null
  notes: string
}

export interface RegisterForScheduledTripResult {
  registration_id: string
  estimated_cost: number | null
  estimated_currency: string | null
  already_registered?: boolean
  emailed?: boolean
}

/**
 * The shop's published Scheduled Trips, soonest-first. Reads the
 * list_scheduled_trips() definer function, which exposes only published rows and
 * carries the catalog add-on/room ids the register form needs.
 */
export async function fetchScheduledTrips(): Promise<ScheduledTripItem[]> {
  const { data, error } = await supabase
    .rpc('list_scheduled_trips')
    .order('start_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as ScheduledTripItem[]
}

/** One published trip by id (for the detail page / deep links), or null. */
export async function fetchScheduledTrip(id: string): Promise<ScheduledTripItem | null> {
  const { data, error } = await supabase
    .rpc('list_scheduled_trips')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as ScheduledTripItem | null
}

/**
 * Register the signed-in diver for a scheduled trip. Runs the
 * register-scheduled-trip edge function, which recomputes the estimate
 * authoritatively, inserts the registration, and emails the shop + diver.
 * Idempotent against the one-live index.
 */
export async function registerForScheduledTrip(
  input: RegisterForScheduledTripInput,
): Promise<RegisterForScheduledTripResult> {
  const { data, error } = await supabase.functions.invoke('register-scheduled-trip', {
    body: {
      scheduled_trip_id: input.scheduledTripId,
      addon_ids: input.addonIds,
      room_id: input.roomId,
      notes: input.notes,
    },
  })
  if (error) {
    // supabase-js wraps a non-2xx as FunctionsHttpError; surface the server body.
    const ctx = (error as { context?: unknown }).context
    if (ctx && typeof (ctx as Response).json === 'function') {
      try {
        const b = await (ctx as Response).json() as { error?: string }
        if (b?.error) throw new Error(b.error)
      } catch (e) {
        if (e instanceof Error) throw e
      }
    }
    throw new Error(error.message)
  }
  return data as RegisterForScheduledTripResult
}

/** The signed-in diver's own scheduled-trip registrations, newest first. */
export async function fetchMyScheduledTripRegistrations(): Promise<MyScheduledTripRegistration[]> {
  const { data, error } = await supabase
    .rpc('list_my_scheduled_trip_registrations')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as MyScheduledTripRegistration[]
}

/** Cancel the diver's own registration (frees a retry). */
export async function cancelMyScheduledTripRegistration(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_my_scheduled_trip_registration', { p_id: id })
  if (error) throw error
}
