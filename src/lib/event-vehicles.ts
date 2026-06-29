import { supabase } from './supabase'
import type { AppEvent, EventVehicle, EventVehicleInsert, Vehicle } from '../types/database'

// Data layer for per-event car allocation (table `event_vehicles`, gated by
// 20260627000000_event_vehicles.sql: staff + admin read, admin write). The
// logistics day view reads allocations for the selected day and lets admins
// assign/unassign cars; a car is exclusive per date, so availability is the
// active fleet minus whatever's already allocated that day.

// All allocations on a given date — both "which cars are taken" (for
// availability) and "which car is on which event" (group by the event key).
export async function fetchVehicleAllocationsForDate(date: string): Promise<EventVehicle[]> {
  const { data, error } = await supabase
    .from('event_vehicles')
    .select('*')
    .eq('event_date', date)
  if (error) throw error
  return (data ?? []) as EventVehicle[]
}

export async function assignVehicleToEvent(args: {
  vehicleId: string
  date: string
  event: Pick<AppEvent, 'id' | 'type'>
  createdBy: string
  notes?: string | null
}): Promise<void> {
  const row: EventVehicleInsert = {
    vehicle_id: args.vehicleId,
    event_date: args.date,
    eo_dive_id: args.event.type === 'dive' ? args.event.id : null,
    eo_course_id: args.event.type === 'course' ? args.event.id : null,
    created_by: args.createdBy,
    notes: args.notes ?? null,
  }
  const { error } = await supabase.from('event_vehicles').insert(row)
  if (error) throw error
}

export async function unassignVehicle(id: string): Promise<void> {
  const { error } = await supabase.from('event_vehicles').delete().eq('id', id)
  if (error) throw error
}

// Carry a dive's car allocations to a new date when its start_date is changed
// on the Edit event form — allocations are keyed by date, so without this they
// would be left stranded on the old day. A car already taken on the new date
// (the unique (vehicle_id, event_date) rule would reject it) is dropped rather
// than moved; the admin re-picks one. Returns how many moved / were dropped.
export async function moveDiveCarAllocations(
  diveId: string, fromDate: string, toDate: string,
): Promise<{ moved: number; dropped: number }> {
  if (fromDate === toDate) return { moved: 0, dropped: 0 }

  const { data: mine, error: mineErr } = await supabase
    .from('event_vehicles').select('id, vehicle_id')
    .eq('eo_dive_id', diveId).eq('event_date', fromDate)
  if (mineErr) throw mineErr
  if (!mine?.length) return { moved: 0, dropped: 0 }

  const { data: taken, error: takenErr } = await supabase
    .from('event_vehicles').select('vehicle_id').eq('event_date', toDate)
  if (takenErr) throw takenErr
  const takenIds = new Set((taken ?? []).map(t => (t as { vehicle_id: string }).vehicle_id))

  let moved = 0, dropped = 0
  for (const row of mine as { id: string; vehicle_id: string }[]) {
    if (takenIds.has(row.vehicle_id)) {
      await supabase.from('event_vehicles').delete().eq('id', row.id)
      dropped++
    } else {
      await supabase.from('event_vehicles').update({ event_date: toDate }).eq('id', row.id)
      takenIds.add(row.vehicle_id)
      moved++
    }
  }
  return { moved, dropped }
}

// The event key an allocation row points at (XOR, so exactly one is set).
export function allocationEventId(a: EventVehicle): string | null {
  return a.eo_dive_id ?? a.eo_course_id
}

// Active cars not already allocated to some event on the date. `allocatedIds`
// is every vehicle_id holding a row that day (across all events), so a car
// assigned to event A drops out of event B's picker — the exclusivity rule
// surfaced in the UI before the DB's unique index would reject it.
export function availableVehicles(active: Vehicle[], allocatedIds: Set<string>): Vehicle[] {
  return active.filter(v => !allocatedIds.has(v.id))
}

export interface RideSeats {
  /** Passenger seats across the cars assigned to the event (driver excluded). */
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
    p_dive_id: event.dive_id ?? null,
    p_course_id: event.course_id ?? null,
  })
  if (error) throw error
  const row = (data as { capacity: number; claimed: number }[] | null)?.[0]
  const capacity = row?.capacity ?? 0
  const claimed = row?.claimed ?? 0
  return { capacity, claimed, available: Math.max(0, capacity - claimed) }
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
