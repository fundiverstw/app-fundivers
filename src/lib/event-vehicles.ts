import { supabase } from './supabase'
import type { AppEvent, EventVehicle, EventVehicleInsert, Vehicle } from '../types/database'

// Data layer for per-event car allocation (table `event_vehicles`, gated by
// 20260627000000_event_vehicles.sql: staff + admin read, admin write). A
// vehicle is assigned to a whole EVENT and may serve any number of events, so
// availability is the active fleet minus whatever's already on THIS event.

// The allocations for one event.
export async function fetchVehiclesForEvent(eventId: string | null): Promise<EventVehicle[]> {
  if (!eventId) return []
  const { data, error } = await supabase.from('event_vehicles').select('*').eq('event_id', eventId)
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

/**
 * Does the shop drive anybody to this event? Read straight off the event row
 * rather than inferred: a course that travels to its open-water days needs a
 * van and a dry course at the shop needs none, and nothing in the kind, the
 * title or the fleet distinguishes the two.
 */
export async function fetchEventHasTransport(eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('events').select('has_transport').eq('id', eventId).maybeSingle()
  if (error) throw error
  return (data as { has_transport?: boolean } | null)?.has_transport ?? true
}

/** Admin-only (events RLS). Turning it off leaves any assigned cars in place —
 *  they are what the event goes back to if it is turned on again. */
export async function setEventHasTransport(eventId: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from('events').update({ has_transport: value } as never).eq('id', eventId)
  if (error) throw error
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
  /** Physical seats across the distinct cars on the event's run. */
  seats: number
  /** On-duty staff on the run — they ride those same seats. */
  staff: number
  /** Rideable seats a diver can claim = seats − staff. */
  capacity: number
  /** Divers already holding a ride anywhere on the run (non-cancelled,
   *  transportation = true), each counted once. */
  claimed: number
  /** Free seats = max(0, capacity - claimed). */
  available: number
}

// Ride-seat tally for an event, via the event_ride_seats SECURITY DEFINER RPC
// (rewritten in 20260724000000) — the only way the registration form, run as a
// plain diver, can learn the count without read access to event_vehicles /
// others' bookings. Measured across the whole run the event travels in, so a
// van shared with another event isn't counted twice.
export async function fetchRideSeats(eventId: string): Promise<RideSeats> {
  const { data, error } = await supabase.rpc('event_ride_seats', {
    p_event_id: eventId,
  })
  if (error) throw error
  const row = (data as RideSeats[] | null)?.[0]
  const capacity = row?.capacity ?? 0
  const claimed = row?.claimed ?? 0
  return {
    seats: row?.seats ?? 0,
    staff: row?.staff ?? 0,
    capacity,
    claimed,
    available: Math.max(0, capacity - claimed),
  }
}

// Whether the registration form should still offer "Yes, I need a ride".
//   - capacity 0 → no cars assigned yet, ride capacity isn't configured, so
//     don't block (keeps the plan-the-van-later flow working).
//   - otherwise allow only while a seat is free. A diver editing a booking that
//     already holds a ride keeps it — their own claim is credited back.
export function canRequestRide(
  args: { capacity: number; claimed: number; alreadyHasRide: boolean },
): boolean {
  if (args.capacity <= 0) return true
  if (args.alreadyHasRide) return true
  return args.capacity - args.claimed > 0
}
