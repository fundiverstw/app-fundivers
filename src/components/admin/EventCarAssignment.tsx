import { useEffect, useState } from 'react'
import { EventVehicleGroup } from './EventVehicleGroup'
import { fetchVehicles } from '../../lib/vehicles'
import {
  fetchVehiclesForEvent, fetchRideSeats, availableVehicles,
} from '../../lib/event-vehicles'
import type { AppEvent, EventVehicle, Vehicle } from '../../types/database'

interface Props {
  event: Pick<AppEvent, 'id' | 'type'>
  isAdmin: boolean
  createdBy: string | null
  /** Live rider count (divers needing a ride). When omitted, it's fetched from
   *  the ride-seat RPC — so this works on surfaces that haven't loaded the
   *  event's bookings (e.g. the Edit event form). */
  riders?: number
}

/**
 * Assign cars to an event and show the resulting ride-seat capacity. Reused on
 * the event detail page (Transportation tab) and the Edit event form. Cars are
 * assigned to the event as a whole — a car may serve several events — so what's
 * assigned here lines up with the Logistics day view.
 */
export function EventCarAssignment({ event, isAdmin, createdBy, riders }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [allocations, setAllocations] = useState<EventVehicle[]>([])
  const [claimed, setClaimed] = useState<number | null>(null)
  const [reload, setReload] = useState(0)


  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await fetchVehicles()
        if (!cancelled) setVehicles(v)
      } catch { /* section just won't offer a picker */ }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchVehiclesForEvent(event.id)
        if (!cancelled) setAllocations(rows)
      } catch { if (!cancelled) setAllocations([]) }
    })()
    return () => { cancelled = true }
  }, [event.id, reload])

  // Rider count when the caller didn't supply one — claimed = divers holding a
  // ride, from the ride-seat RPC.
  useEffect(() => {
    if (riders != null) return
    let cancelled = false
    fetchRideSeats(event.id)
      .then(s => { if (!cancelled) setClaimed(s.claimed) })
      .catch(() => { /* leave null */ })
    return () => { cancelled = true }
  }, [event.id, riders, reload])

  const riderCount = riders ?? claimed ?? 0
  const activeVehicles = vehicles.filter(v => v.active)
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
  const assignedVehicleIds = new Set(allocations.map(a => a.vehicle_id))
  const available = availableVehicles(activeVehicles, assignedVehicleIds)
  const capacity = allocations.reduce((s, a) => s + (vehicleMap.get(a.vehicle_id)?.passenger_seats ?? 0), 0)
  const short = capacity > 0 && riderCount > capacity

  return (
    <div className="space-y-2">
      <EventVehicleGroup
        event={event}
        allocations={allocations}
        available={available}
        vehicleMap={vehicleMap}
        riders={riderCount}
        isAdmin={isAdmin}
        createdBy={createdBy}
        onChanged={() => setReload(k => k + 1)}
      />
      {short && (
        <p className="text-xs text-red-600 font-semibold pl-1">
          Short {riderCount - capacity} seat{riderCount - capacity === 1 ? '' : 's'} — {riderCount} need a ride but only {capacity} assigned.
        </p>
      )}
    </div>
  )
}
