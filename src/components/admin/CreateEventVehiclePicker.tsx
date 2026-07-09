import { useEffect, useState } from 'react'
import { fetchVehicles } from '../../lib/vehicles'
import type { Vehicle } from '../../types/database'
import { t } from '../../i18n'

const tp = t.admin.transport

interface Props {
  /** Reports the picked vehicle ids up so the create page can assign them to
   *  the new event once its row exists. */
  onChange: (vehicleIds: string[]) => void
}

/**
 * Car assignment for the New-event form. The event row doesn't exist yet, so
 * this holds the picked vehicles in local state and hands the ids up; the page
 * persists them (event_vehicles) right after inserting the event. Cars serve any
 * number of events here (event-level allocation), so no date filtering. Edit
 * uses the DB-backed EventCarAssignment instead.
 */
export function CreateEventVehiclePicker({ onChange }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await fetchVehicles()
        if (!cancelled) setVehicles(v.filter(x => x.active))
      } catch { /* no fleet loaded — section stays empty */ }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Report the current selection up in an effect (not inside the state updater),
  // so it re-syncs to empty on remount (dive→course→dive type switch).
  useEffect(() => {
    onChange([...selected])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const seats = vehicles
    .filter(v => selected.has(v.id))
    .reduce((s, v) => s + v.passenger_seats, 0)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">{tp.carsForDive}</h2>
        {selected.size > 0 && (
          <span className="text-xs text-white/70 font-semibold">{seats} passenger seat{seats === 1 ? '' : 's'}</span>
        )}
      </div>
      <p className="text-xs text-white/60">
        Cars assigned here set the ride-seat limit on the registration form — a diver can only
        request a ride when a seat is free in one of them. You can change these later.
      </p>
      {loading ? (
        <p className="text-sm text-white/60">{tp.loadingCars}</p>
      ) : vehicles.length === 0 ? (
        <p className="text-sm text-brand-950 font-medium bg-white/70 rounded-md p-2">{tp.noActiveCars}</p>
      ) : (
        <div className="space-y-1 max-h-56 overflow-y-auto bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
          {vehicles.map(v => (
            <label key={v.id} className="flex items-center gap-2 text-sm text-brand-950 font-medium">
              <input
                type="checkbox"
                checked={selected.has(v.id)}
                onChange={() => toggle(v.id)}
                className="accent-brand-900"
              />
              <span>{v.name} ({v.passenger_seats} seat{v.passenger_seats === 1 ? '' : 's'})</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
