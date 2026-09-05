import { useEffect, useState } from 'react'
import { fetchVehicles, createVehicle } from '../../lib/vehicles'
import { errorMessage } from '../../lib/errors'
import { BTN_XS_GHOST, BTN_XS_PRIMARY, ERROR_NOTE_LIGHT } from '../../styles/tokens'
import type { Vehicle } from '../../types/database'
import { t } from '../../i18n'

const tp = t.admin.transport
const ev = t.admin.events

interface Props {
  /** Reports the picked vehicle ids up so the create page can assign them to
   *  the new event once its row exists. Empty while transport is switched off. */
  onChange: (vehicleIds: string[]) => void
  /** Reports the has_transport column the new event row should carry. */
  onTransportChange: (hasTransport: boolean) => void
}

/**
 * Car assignment for the New-event form. The event row doesn't exist yet, so
 * this holds the picked vehicles in local state and hands the ids up; the page
 * persists them (event_vehicles) right after inserting the event. Cars serve any
 * number of events here (event-level allocation), so no date filtering. Edit
 * uses the DB-backed EventCarAssignment instead.
 *
 * The "transport not needed" switch is the same one EventCarAssignment carries
 * on the edit side; here it feeds the new row's has_transport rather than an
 * update. Off means the registration form asks no diver about a ride, so the
 * car picker has nothing left to pick for and hides.
 */
export function CreateEventVehiclePicker({ onChange, onTransportChange }: Props) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hasTransport, setHasTransport] = useState(true)
  const [loading, setLoading] = useState(true)
  // Adding a car from here, rather than sending the admin to Manage → Vehicles
  // and back: leaving this page abandons a half-filled event form.
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSeats, setNewSeats] = useState('')
  const [savingVehicle, setSavingVehicle] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

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
  // so it re-syncs to empty on remount (dive→course→dive type switch). An event
  // that carries nobody reports no cars, whatever is still ticked underneath.
  useEffect(() => {
    onChange(hasTransport ? [...selected] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, hasTransport])

  useEffect(() => {
    onTransportChange(hasTransport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTransport])

  async function addVehicle() {
    const name = newName.trim()
    const seats = Number(newSeats)
    if (!name) { setAddError(tp.newVehicleNameRequired); return }
    if (!Number.isFinite(seats) || seats < 1) { setAddError(tp.newVehicleSeatsRequired); return }
    setSavingVehicle(true)
    setAddError(null)
    try {
      const vehicle = await createVehicle({ name, passenger_seats: seats, active: true })
      // A car added here was added for this event, so it arrives ticked.
      setVehicles(prev => [vehicle, ...prev])
      setSelected(prev => new Set(prev).add(vehicle.id))
      setNewName('')
      setNewSeats('')
      setAdding(false)
    } catch (err) {
      setAddError(tp.newVehicleFailed(errorMessage(err)))
    } finally {
      setSavingVehicle(false)
    }
  }

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
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">{tp.carsForEvent}</h2>
        {hasTransport && selected.size > 0 && (
          <span className="text-xs text-white/70 font-semibold">{seats} passenger seat{seats === 1 ? '' : 's'}</span>
        )}
      </div>
      <p className="text-xs text-white/60">{ev.carsBlurb}</p>
      <label className="flex items-start gap-2 text-sm text-white/80 font-medium">
        <input
          type="checkbox"
          checked={!hasTransport}
          onChange={e => setHasTransport(!e.target.checked)}
          className="accent-brand-900 mt-0.5"
        />
        <span className="flex-1">{tp.noTransportLabel}</span>
      </label>
      <p className="text-xs text-white/60 pl-6">{tp.noTransportHint}</p>
      {!hasTransport ? null : loading ? (
        <p className="text-sm text-white/60">{tp.loadingCars}</p>
      ) : (
        <>
          {vehicles.length === 0 ? (
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

          {adding ? (
            <div className="space-y-2 bg-white/70 backdrop-blur-md border border-surface-200 rounded-md p-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-brand-950">{tp.newVehicleName}</span>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder={tp.newVehicleNamePh}
                  className={FIELD}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-brand-950">{tp.newVehicleSeats}</span>
                <input
                  type="number"
                  min={1}
                  value={newSeats}
                  onChange={e => setNewSeats(e.target.value)}
                  className={FIELD}
                />
              </label>
              {addError && <p className={ERROR_NOTE_LIGHT}>{addError}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => void addVehicle()} disabled={savingVehicle} className={BTN_XS_PRIMARY}>
                  {savingVehicle ? tp.savingVehicle : tp.saveVehicle}
                </button>
                <button
                  type="button"
                  onClick={() => { setAdding(false); setAddError(null) }}
                  className={BTN_XS_GHOST}
                >
                  {t.common.cancel}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={BTN_XS_GHOST}>
              {tp.addVehicle}
            </button>
          )}
        </>
      )}
    </div>
  )
}

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-2 py-1 text-sm text-brand-950 focus:outline-none focus:border-brand-900'
