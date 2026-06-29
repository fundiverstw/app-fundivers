import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { EventVehicleGroup } from './EventVehicleGroup'
import { fetchVehicles } from '../../lib/vehicles'
import {
  fetchVehicleAllocationsForDate, fetchRideSeats, availableVehicles, allocationEventId,
} from '../../lib/event-vehicles'
import type { EventVehicle, Vehicle } from '../../types/database'

interface Props {
  /** The dive's EO_dives _id. */
  eventId: string
  isAdmin: boolean
  createdBy: string | null
  /** Live rider count (divers needing a ride). When omitted, it's fetched from
   *  the ride-seat RPC — so this works on surfaces that haven't loaded the
   *  event's bookings (e.g. the Edit event form). */
  riders?: number
}

/**
 * Assign cars to a dive on its date and show the resulting ride-seat capacity.
 * Reused on the event detail page (Transportation tab) and the Edit event form.
 * Allocations are keyed on the dive's start_date — the same day logistics shows
 * the dive on — so what's assigned here lines up across all three surfaces.
 */
export function EventCarAssignment({ eventId, isAdmin, createdBy, riders }: Props) {
  const [dayKey, setDayKey] = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [allocations, setAllocations] = useState<EventVehicle[]>([])
  const [claimed, setClaimed] = useState<number | null>(null)
  const [reload, setReload] = useState(0)

  // The dive's saved start_date (a plain date, not the ISO start_time which can
  // shift across the date line by timezone).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('EO_dives').select('start_date').eq('_id', eventId).maybeSingle()
      if (!cancelled) setDayKey((data as { start_date: string | null } | null)?.start_date ?? null)
    })()
    return () => { cancelled = true }
  }, [eventId])

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
    if (!dayKey) return
    let cancelled = false
    ;(async () => {
      try {
        const rows = await fetchVehicleAllocationsForDate(dayKey)
        if (!cancelled) setAllocations(rows)
      } catch { if (!cancelled) setAllocations([]) }
    })()
    return () => { cancelled = true }
  }, [dayKey, reload])

  // Rider count when the caller didn't supply one — claimed = divers holding a
  // ride, from the ride-seat RPC.
  useEffect(() => {
    if (riders != null) return
    let cancelled = false
    fetchRideSeats({ dive_id: eventId })
      .then(s => { if (!cancelled) setClaimed(s.claimed) })
      .catch(() => { /* leave null */ })
    return () => { cancelled = true }
  }, [eventId, riders, reload])

  if (!dayKey) return null

  const riderCount = riders ?? claimed ?? 0
  const activeVehicles = vehicles.filter(v => v.active)
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
  const allocatedVehicleIds = new Set(allocations.map(a => a.vehicle_id))
  const available = availableVehicles(activeVehicles, allocatedVehicleIds)
  const mine = allocations.filter(a => allocationEventId(a) === eventId)
  const capacity = mine.reduce((s, a) => s + (vehicleMap.get(a.vehicle_id)?.passenger_seats ?? 0), 0)
  const short = capacity > 0 && riderCount > capacity

  return (
    <div className="space-y-2">
      <EventVehicleGroup
        event={{ id: eventId, type: 'dive' }}
        dayKey={dayKey}
        allocations={mine}
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
