import { useEffect, useState } from 'react'
import { EventVehicleGroup } from './EventVehicleGroup'
import { fetchVehicles } from '../../lib/vehicles'
import {
  fetchVehiclesForEvent, fetchRideSeats, availableVehicles,
  fetchEventHasTransport, setEventHasTransport, type RideSeats,
} from '../../lib/event-vehicles'
import { fetchRidePartnerTitles } from '../../lib/ride-groups'
import { t } from '../../i18n'
import type { AppEvent, EventVehicle, Vehicle } from '../../types/database'

const tp = t.admin.transport

interface Props {
  event: Pick<AppEvent, 'id' | 'type'>
  isAdmin: boolean
  createdBy: string | null
}

/**
 * Assign cars to an event and show the resulting ride-seat capacity. Reused on
 * the event detail page (Transportation tab) and the Edit event form. Cars are
 * assigned to the event as a whole — a car may serve several events — so what's
 * assigned here lines up with the Logistics day view.
 *
 * Every number comes from the event_ride_seats RPC, which measures the whole
 * run the event travels in (see src/lib/ride-groups.ts): seats over the run's
 * distinct cars, the on-duty staff riding them, and the divers already holding
 * a ride. Deriving them from this event's own allocations instead would
 * contradict the Logistics board the moment two events share a van.
 *
 * The section also carries the one switch that says this event carries nobody
 * at all (events.has_transport). A dry course — EFR, Equipment, an O2 provider
 * course — moves no one, and the registration form should put no ride question
 * to a diver signing up for one. It is a switch rather than a guess because
 * "not strictly a diving course" is not something the kind or the title says.
 */
export function EventCarAssignment({ event, isAdmin, createdBy }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [allocations, setAllocations] = useState<EventVehicle[]>([])
  const [seats, setSeats] = useState<RideSeats | null>(null)
  const [partners, setPartners] = useState<string[]>([])
  const [reload, setReload] = useState(0)
  const [hasTransport, setHasTransport] = useState(true)
  const [transportErr, setTransportErr] = useState('')


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

  useEffect(() => {
    let cancelled = false
    fetchRideSeats(event.id)
      .then(s => { if (!cancelled) setSeats(s) })
      .catch(() => { /* leave null — the block still assigns cars */ })
    return () => { cancelled = true }
  }, [event.id, reload])

  useEffect(() => {
    let cancelled = false
    fetchEventHasTransport(event.id)
      .then(v => { if (!cancelled) setHasTransport(v) })
      .catch(() => { /* fall back to offering transport, the column's own default */ })
    return () => { cancelled = true }
  }, [event.id])

  useEffect(() => {
    let cancelled = false
    fetchRidePartnerTitles(event.id)
      .then(p => { if (!cancelled) setPartners(p) })
      .catch(() => { /* grouping is admin-curated; absent is fine */ })
    return () => { cancelled = true }
  }, [event.id, reload])

  const activeVehicles = vehicles.filter(v => v.active)
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
  const available = availableVehicles(activeVehicles, new Set(allocations.map(a => a.vehicle_id)))
  // Bodies the run must move: the divers holding a ride plus the on-duty staff
  // sharing those seats.
  const riders = (seats?.claimed ?? 0) + (seats?.staff ?? 0)
  const shortBy = seats ? Math.max(0, seats.claimed - seats.capacity) : 0

  // Optimistic: the checkbox flips at once and rolls back if the write fails,
  // so a staff member never sees a tick that didn't land.
  async function toggleTransport(next: boolean) {
    setTransportErr('')
    setHasTransport(next)
    try {
      await setEventHasTransport(event.id, next)
    } catch {
      setHasTransport(!next)
      setTransportErr(tp.noTransportFailed)
    }
  }

  return (
    <div className="space-y-2">
      {isAdmin ? (
        <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2 space-y-1">
          <label className="flex items-start gap-2 text-sm text-brand-950 font-medium">
            <input
              type="checkbox"
              checked={!hasTransport}
              onChange={e => toggleTransport(!e.target.checked)}
              className="accent-brand-900 mt-0.5"
            />
            <span className="flex-1">{tp.noTransportLabel}</span>
          </label>
          <p className="text-xs text-brand-950/70 font-medium pl-6">{tp.noTransportHint}</p>
          {transportErr && <p className="text-xs text-red-600 font-semibold pl-6">{transportErr}</p>}
        </div>
      ) : !hasTransport && (
        <p className="text-xs text-brand-950 font-medium bg-white/70 rounded-md p-2">{tp.noTransportOn}</p>
      )}

      {!hasTransport ? (
        <>
          {/* Turning the switch off does not rewrite bookings that already
              hold a ride, and this event has just left the Logistics rides
              board. Somebody has to be told, or the two admin surfaces
              disagree in silence. */}
          {(seats?.claimed ?? 0) > 0 && (
            <p className="text-xs text-amber-700 font-semibold pl-1">
              {tp.noTransportRidersLeft(seats!.claimed)}
            </p>
          )}
          {allocations.length > 0 && (
            <p className="text-xs text-amber-700 font-semibold pl-1">
              {tp.noTransportCarsLeft(allocations.length)}
            </p>
          )}
        </>
      ) : (
        <>
          <EventVehicleGroup
            event={event}
            allocations={allocations}
            available={available}
            vehicleMap={vehicleMap}
            riders={riders}
            runSeats={seats?.seats ?? 0}
            sharedWith={partners}
            isAdmin={isAdmin}
            createdBy={createdBy}
            onChanged={() => setReload(k => k + 1)}
          />
          {shortBy > 0 && (
            <p className="text-xs text-red-600 font-semibold pl-1">
              {tp.eventRideShort(shortBy, seats!.claimed, seats!.capacity)}
            </p>
          )}
        </>
      )}
    </div>
  )
}
