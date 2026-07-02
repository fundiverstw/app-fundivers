import { useState } from 'react'
import { assignVehicleToEvent, unassignVehicle } from '../../lib/event-vehicles'
import type { AppEvent, EventVehicle, Vehicle } from '../../types/database'

interface Props {
  event: Pick<AppEvent, 'id' | 'type'>
  // This event's allocations, and the active cars not yet on this event (a car
  // may serve several events, so it only drops from its own event's picker).
  allocations: EventVehicle[]
  available: Vehicle[]
  vehicleMap: Map<string, Vehicle>
  // Bodies the shop must move for this event (divers needing a ride + on-duty
  // staff) — shown next to the assigned seat total as a sanity check.
  riders: number
  isAdmin: boolean
  createdBy: string | null
  onChanged: () => void
}

/**
 * Per-event car allocation, shown inside the Logistics day view under each
 * event and on the event forms. Lists the cars assigned to this event (with
 * their passenger-seat totals) and, for admins, a picker of the active cars not
 * already on it. A car can serve any number of events, so assigning it here
 * does not remove it from other events.
 */
export function EventVehicleGroup({
  event, allocations, available, vehicleMap, riders, isAdmin, createdBy, onChanged,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Staff (read-only) with nothing assigned: nothing useful to show.
  if (!isAdmin && allocations.length === 0) return null

  const assignedSeats = allocations.reduce(
    (sum, a) => sum + (vehicleMap.get(a.vehicle_id)?.passenger_seats ?? 0), 0,
  )

  async function assign(vehicleId: string) {
    if (!vehicleId || !createdBy) return
    setBusy(true); setError(null)
    try {
      await assignVehicleToEvent({ vehicleId, event, createdBy })
      onChanged()
    } catch {
      setError('Could not assign that car — it may already be on this event.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true); setError(null)
    try {
      await unassignVehicle(id)
      onChanged()
    } catch {
      setError('Could not remove that car.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="group" aria-label="Assigned cars" className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-brand-900">Cars</h2>
        <span className="text-xs text-brand-900 font-semibold">
          {assignedSeats} seat{assignedSeats === 1 ? '' : 's'} · {riders} to transport
        </span>
      </div>

      {allocations.length === 0 ? (
        <p className="text-xs text-brand-950/70 font-medium italic">No car assigned yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {allocations.map(a => {
            const v = vehicleMap.get(a.vehicle_id)
            return (
              <li key={a.id} className="flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border border-brand-900 text-brand-900 font-medium">
                <span>{v?.name ?? '(unknown car)'}{v ? ` (${v.passenger_seats})` : ''}</span>
                {isAdmin && (
                  <button
                    type="button"
                    aria-label={`Unassign ${v?.name ?? 'car'}`}
                    disabled={busy}
                    onClick={() => remove(a.id)}
                    className="text-brand-900 hover:text-red-600 disabled:opacity-50 leading-none"
                  >
                    ×
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {isAdmin && (
        available.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-brand-900 font-medium">
            <span className="uppercase tracking-wide">Assign a car</span>
            <select
              aria-label="Assign a car"
              disabled={busy}
              value=""
              onChange={e => assign(e.target.value)}
              className="px-2 py-1 rounded-full text-xs bg-surface-100 text-brand-900 border border-surface-200 disabled:opacity-50"
            >
              <option value="">Select a car…</option>
              {available.map(v => (
                <option key={v.id} value={v.id}>{v.name} ({v.passenger_seats})</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs text-brand-950/70 font-medium italic">
            Every active car is already assigned to this event.
          </p>
        )
      )}

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
    </div>
  )
}
