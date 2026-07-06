import { supabase } from './supabase'
import type { AppEvent, EventVehicle, EventVehicleInsert, Vehicle } from '../types/database'

// Data layer for per-event car allocation (table `event_vehicles`, gated by
// 20260627000000_event_vehicles.sql: staff + admin read, admin write). A
// vehicle is assigned to a whole EVENT and may serve any number of events, so
// availability is the active fleet minus whatever's already on THIS event.

// The allocations for one event.
export async function fetchVehiclesForEvent(
  event: { dive_id?: string | null; course_id?: string | null },
): Promise<EventVehicle[]> {
  const val = event.dive_id ?? event.course_id
  if (!val) return []
  const { data, error } = await supabase.from('event_vehicles').select('*').eq('event_id', val)
  if (error) throw error
  return (data ?? []) as EventVehicle[]
}

// Allocations across several events at once — the logistics day view fetches
// every allocation for the events it lists that day, in one round trip.
export async function fetchVehiclesForEvents(eventIds: string[]): Promise<EventVehicle[]> {
  if (eventIds.length === 0) return []
  const { data, error } = await supabase
    .from('event_vehicles').select('*').in('event_id', eventIds)
  if (error) throw error
  return (data ?? []) as EventVehicle[]
}

function allocationRow(
  vehicleId: string, event: Pick<AppEvent, 'id' | 'type'>, createdBy: string | null, notes?: string | null,
): EventVehicleInsert {
  return {
    vehicle_id: vehicleId,
    event_id: event.id,
    created_by: createdBy,
    notes: notes ?? null,
  }
}

export async function assignVehicleToEvent(args: {
  vehicleId: string
  event: Pick<AppEvent, 'id' | 'type'>
  createdBy: string
  notes?: string | null
}): Promise<void> {
  const { error } = await supabase
    .from('event_vehicles')
    .insert(allocationRow(args.vehicleId, args.event, args.createdBy, args.notes))
  if (error) throw error
}

// Assign several vehicles to one event in a single insert — used when the
// create-event form persists its picked cars right after the event row exists.
export async function assignVehiclesToEvent(args: {
  vehicleIds: string[]
  event: Pick<AppEvent, 'id' | 'type'>
  createdBy: string | null
}): Promise<void> {
  if (args.vehicleIds.length === 0) return
  const rows = args.vehicleIds.map(id => allocationRow(id, args.event, args.createdBy))
  const { error } = await supabase.from('event_vehicles').insert(rows)
  if (error) throw error
}

export async function unassignVehicle(id: string): Promise<void> {
  const { error } = await supabase.from('event_vehicles').delete().eq('id', id)
  if (error) throw error
}

// The event an allocation row points at.
export function allocationEventId(a: EventVehicle): string | null {
  return a.event_id
}

// Active cars not already assigned to THIS event. `assignedIds` is the set of
// vehicle_ids already on the event — a car can be on several events, so it only
// drops out of the picker for the event it's already on.
export function availableVehicles(active: Vehicle[], assignedIds: Set<string>): Vehicle[] {
  return active.filter(v => !assignedIds.has(v.id))
}

export interface RideSeats {
  /** Rideable seats a diver can claim — total physical seats across the
   *  assigned cars minus the crew's seats (the greater of one driver per
   *  vehicle or the full on-duty staff count, who all ride the fleet). */
  capacity: number
  /** Divers already holding a ride (non-cancelled, transportation = true). */
  claimed: number
  /** Free seats = max(0, capacity - claimed). */
  available: number
}

// Ride-seat tally for an event, via the event_ride_seats SECURITY DEFINER RPC
// (20260628000000) — the only way the registration form, run as a plain diver,
// can learn the count without read access to event_vehicles / others' bookings.
export async function fetchRideSeats(
  event: { dive_id?: string | null; course_id?: string | null },
): Promise<RideSeats> {
  const { data, error } = await supabase.rpc('event_ride_seats', {
    p_event_id: (event.dive_id ?? event.course_id) as string,
  })
  if (error) throw error
  const row = (data as { capacity: number; claimed: number }[] | null)?.[0]
  const capacity = row?.capacity ?? 0
  const claimed = row?.claimed ?? 0
  return { capacity, claimed, available: Math.max(0, capacity - claimed) }
}

// Whether the registration form should still offer "Yes, I need a ride". A
// diver can only ride in a car assigned to their event:
//   - a diver already holding a ride keeps it — their own claim is credited back.
//   - capacity 0 → no car assigned to the event, so no ride is available.
//   - otherwise allow only while a seat is free.
export function canRequestRide(
  args: { capacity: number; claimed: number; alreadyHasRide: boolean },
): boolean {
  if (args.alreadyHasRide) return true
  if (args.capacity <= 0) return false
  return args.capacity - args.claimed > 0
}
