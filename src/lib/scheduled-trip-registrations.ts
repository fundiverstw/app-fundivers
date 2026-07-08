import { supabase } from './supabase'
import type { ScheduledTripRegistration, RegistrationStatus } from '../types/database'

// Admin data layer for scheduled-trip registrations — the "who registered for a
// trip" roster surfaced in Manage. Divers register through the
// register-scheduled-trip edge function and read their own via
// list_my_scheduled_trip_registrations(); this module is the admin side against
// the base table (gated by its "admin manage" RLS policy). No kickback ledger —
// these are the shop's own trips.

export interface RegistrationDiver {
  id: string
  name: string | null
  nickname: string | null
  email: string | null
  contact_id: string | null
}

export interface AdminScheduledTripRegistration extends ScheduledTripRegistration {
  diver: RegistrationDiver | null
  trip_title: string | null
}

export async function fetchRegistrationsWithDivers(): Promise<AdminScheduledTripRegistration[]> {
  const { data: regs, error } = await supabase
    .from('scheduled_trip_registrations')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (regs ?? []) as ScheduledTripRegistration[]

  const diverIds = [...new Set(rows.map(r => r.diver_id))]
  const tripIds = [...new Set(rows.map(r => r.scheduled_trip_id))]

  // The two label lookups are independent — run them in one round-trip.
  const [diversRes, tripsRes] = await Promise.all([
    diverIds.length
      ? supabase.from('profiles').select('id, name, nickname, email, contact_id').in('id', diverIds)
      : Promise.resolve({ data: [], error: null }),
    tripIds.length
      ? supabase.from('scheduled_trips').select('id, title').in('id', tripIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (diversRes.error) throw diversRes.error
  if (tripsRes.error) throw tripsRes.error

  const byDiver = new Map<string, RegistrationDiver>()
  for (const p of diversRes.data ?? []) byDiver.set((p as RegistrationDiver).id, p as RegistrationDiver)
  const titleById = new Map<string, string>()
  for (const t of tripsRes.data ?? []) titleById.set((t as { id: string }).id, (t as { title: string }).title)

  return rows.map(r => ({
    ...r,
    diver: byDiver.get(r.diver_id) ?? null,
    trip_title: titleById.get(r.scheduled_trip_id) ?? null,
  }))
}

/** Count of live (still 'registered') registrations — the admin's badge. */
export async function countNewRegistrations(): Promise<number> {
  const { count, error } = await supabase
    .from('scheduled_trip_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'registered')
  if (error) throw error
  return count ?? 0
}

/** Move a registration through the pipeline (registered → completed, or cancel). */
export async function setRegistrationStatus(id: string, status: RegistrationStatus): Promise<void> {
  const { error } = await supabase.from('scheduled_trip_registrations').update({ status }).eq('id', id)
  if (error) throw error
}
