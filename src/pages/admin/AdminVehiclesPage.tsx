import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchVehicles, saveVehicle, deleteVehicle } from '../../lib/vehicles'
import type { Vehicle, VehicleInsert } from '../../types/database'
import { t } from '../../i18n'

const ve = t.admin.vehicles
const wv = t.admin.waivers

// Admin catalog for the shop's transport fleet. Each vehicle carries
// `passenger_seats` physical seats. The logistics day view plans rides against
// the active vehicles here.

const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

export function AdminVehiclesPage() {
  const toast = useToast()
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Vehicle | null>(null)

  async function reload() {
    try {
      setVehicles(await fetchVehicles())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const v = await fetchVehicles()
        if (!cancelled) setVehicles(v)
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function handleDelete(v: Vehicle) {
    try {
      await deleteVehicle(v.id)
      toast.success(ve.deleted)
      setConfirmDelete(null)
      await reload()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">{ve.title}</h1>
        <button type="button" onClick={() => setCreating(true)}
          className="text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg">
          {ve.newVehicle}
        </button>
      </div>
      <p className="text-sm text-white/80">
        {ve.intro}
      </p>

      {loadError && (
        <p className="text-sm text-red-200 bg-red-900/50 border border-accent rounded-md p-2">{loadError}</p>
      )}

      {loading ? (
        <p className="text-sm text-white/70">{wv.loading}</p>
      ) : vehicles.length === 0 ? (
        <p className="text-sm text-white/70">{ve.none}</p>
      ) : (
        <ul className="space-y-2">
          {vehicles.map(v => (
            <li key={v.id} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-brand-900 text-sm truncate">
                  {v.name}{!v.active && <span className="ml-2 text-xs text-brand-900/60">{ve.retired}</span>}
                </p>
                <p className="text-xs text-brand-900/80">
                  {ve.seats(v.passenger_seats)}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => setEditing(v)}
                  className="text-xs font-semibold bg-brand-900 hover:bg-brand-950 text-white px-3 py-1 rounded-lg">{wv.edit}</button>
                <button type="button" onClick={() => setConfirmDelete(v)}
                  className="text-xs font-semibold bg-red-700 hover:bg-red-800 text-white px-3 py-1 rounded-lg">{wv.delete}</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <VehicleForm
          vehicle={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={async () => { setCreating(false); setEditing(null); toast.success(ve.saved); await reload() }}
          onError={m => toast.error(m)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={ve.deleteTitle}
          body={ve.deleteBody(confirmDelete.name)}
          confirmLabel={wv.delete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}
    </div>
  )
}

function VehicleForm({
  vehicle, onClose, onSaved, onError,
}: {
  vehicle: Vehicle | null
  onClose: () => void
  onSaved: () => Promise<void>
  onError: (m: string) => void
}) {
  const [name, setName] = useState(vehicle?.name ?? '')
  const [seats, setSeats] = useState((vehicle?.passenger_seats ?? 4).toString())
  const [active, setActive] = useState(vehicle?.active ?? true)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const seatCount = Number(seats)
    if (!name.trim()) { onError(ve.nameRequired); return }
    if (!Number.isInteger(seatCount) || seatCount < 1) { onError(ve.seatsInvalid); return }
    setSubmitting(true)
    try {
      const values: VehicleInsert = { name: name.trim(), passenger_seats: seatCount, active }
      await saveVehicle(values, vehicle?.id)
      await onSaved()
    } catch (err) {
      onError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal labelledBy="vehicle-form-title" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <h2 id="vehicle-form-title" className="text-lg font-bold text-brand-900">{vehicle ? ve.editVehicle : ve.newVehicleTitle}</h2>
        <Labelled label={ve.nameLabel}>
          <input className={FIELD} value={name} onChange={e => setName(e.target.value)} placeholder={ve.namePh} />
        </Labelled>
        <Labelled label={ve.seatsLabel}>
          <input className={FIELD} type="number" min={1} step={1} value={seats} onChange={e => setSeats(e.target.value)} />
        </Labelled>
        <label className="flex items-center gap-2 text-sm text-brand-900">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-brand-900" />
          {ve.inService}
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">{wv.cancel}</button>
          <button type="submit" disabled={submitting}
            className="text-sm font-semibold bg-brand-900 hover:bg-brand-950 disabled:opacity-50 text-white px-4 py-1.5 rounded-lg">
            {submitting ? wv.saving : wv.save}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-brand-900">{label}</span>
      {children}
    </label>
  )
}

function Modal({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function ConfirmModal({
  title, body, confirmLabel, onClose, onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal labelledBy="vehicle-confirm-title" onClose={onClose}>
      <h2 id="vehicle-confirm-title" className="text-lg font-bold text-brand-900">{title}</h2>
      <p className="text-sm text-brand-900/80">{body}</p>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-900 px-3 py-1.5">Cancel</button>
        <button type="button" onClick={onConfirm}
          className="text-sm font-semibold bg-red-700 hover:bg-red-800 text-white px-4 py-1.5 rounded-lg">{confirmLabel}</button>
      </div>
    </Modal>
  )
}
