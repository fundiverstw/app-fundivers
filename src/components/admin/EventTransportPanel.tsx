import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { splitByTransport } from '../../lib/logistics'
import { TransportGroup } from './TransportGroup'
import { EventVehicleGroup } from './EventVehicleGroup'
import { setBookingTransportation } from '../../lib/booking-transport'
import { fetchVehicles } from '../../lib/vehicles'
import {
  fetchVehicleAllocationsForDate, availableVehicles, allocationEventId,
} from '../../lib/event-vehicles'
import type { AppEvent, Booking, BookingDetails, EventVehicle, Profile, Vehicle } from '../../types/database'

export interface TransportRegistrant {
  booking: Booking
  profile: Profile | null
}

interface Props {
  event: AppEvent
  registrants: TransportRegistrant[]
  isAdmin: boolean
  createdBy: string | null
  /** Patch the page's copy of a booking after a ride flip, so the buckets and
   *  the other tabs stay in sync. */
  onRideChanged: (bookingId: string, details: BookingDetails) => void
}

const transportOf = (b: Booking): boolean | undefined =>
  (b.details as BookingDetails | undefined)?.transportation

/**
 * Editable transportation panel for a dive's admin page. Three parts:
 *  1. Per-diver ride choice (admin flips Needs ride / Self-transport; this is
 *     logistics-only — it never touches the frozen charge snapshot). Staff see
 *     the read-only buckets.
 *  2. The dive's transport blurb (DiveTravel.transportation) — a shared catalog
 *     field, editable inline. Dives only.
 *  3. The cars assigned to the dive on its date + the resulting ride seats,
 *     reusing the logistics allocation UI. Dives only.
 */
export function EventTransportPanel({ event, registrants, isAdmin, createdBy, onRideChanged }: Props) {
  const active = registrants.filter(r => r.booking.status !== 'cancelled')
  const hasCancelled = registrants.some(r => r.booking.status === 'cancelled')
  const isDive = event.type === 'dive'
  const needsRideCount = active.filter(r => transportOf(r.booking) === true).length

  return (
    <section className="space-y-3">
      {isAdmin ? (
        <RideChoiceList active={active} onRideChanged={onRideChanged} />
      ) : (
        <ReadOnlyBuckets active={active} />
      )}

      {hasCancelled && (
        <p className="text-xs text-blue-950/70 font-medium italic">Cancelled bookings hidden.</p>
      )}

      {isDive && (
        <>
          <TransportTextEditor event={event} isAdmin={isAdmin} />
          <DiveVehicleSection
            event={event}
            isAdmin={isAdmin}
            createdBy={createdBy}
            riders={needsRideCount}
          />
        </>
      )}
    </section>
  )
}

// ── 1a. Editable per-diver ride choice (admin) ──────────────────────────────
function RideChoiceList({ active, onRideChanged }: {
  active: TransportRegistrant[]
  onRideChanged: (bookingId: string, details: BookingDetails) => void
}) {
  return (
    <div role="group" aria-label="Ride choices" className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-blue-900">Ride choices</h2>
      {active.length === 0 ? (
        <p className="text-xs text-blue-950/70 font-medium italic">No active registrants.</p>
      ) : (
        <ul className="divide-y divide-sky-200">
          {active.map(r => (
            <RideChoiceRow key={r.booking.id} row={r} onRideChanged={onRideChanged} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RideChoiceRow({ row, onRideChanged }: {
  row: TransportRegistrant
  onRideChanged: (bookingId: string, details: BookingDetails) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const current = transportOf(row.booking)

  async function set(value: boolean) {
    if (value === current || busy) return
    setBusy(true); setError(false)
    try {
      const next = await setBookingTransportation(
        row.booking.id, row.booking.details as BookingDetails | undefined, value,
      )
      onRideChanged(row.booking.id, next)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="py-2 flex items-center justify-between gap-3">
      <span className="text-sm text-blue-900 font-medium min-w-0">
        {row.profile?.name ?? '(no profile)'}
        {row.profile?.nickname && row.profile.nickname !== row.profile.name && (
          <span className="text-blue-900/80 font-medium"> ({row.profile.nickname})</span>
        )}
        {error && <span className="text-xs text-red-600 font-medium"> · couldn't save</span>}
      </span>
      <span className="shrink-0 inline-flex rounded-lg overflow-hidden border border-sky-300">
        <SegBtn active={current === true}  disabled={busy} onClick={() => set(true)}>Needs ride</SegBtn>
        <SegBtn active={current === false} disabled={busy} onClick={() => set(false)}>Self</SegBtn>
      </span>
    </li>
  )
}

function SegBtn({ active, disabled, onClick, children }: {
  active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
        active ? 'bg-blue-900 text-white' : 'bg-white text-blue-900 hover:bg-sky-50'
      }`}
    >
      {children}
    </button>
  )
}

// ── 1b. Read-only buckets (staff) ───────────────────────────────────────────
function ReadOnlyBuckets({ active }: { active: TransportRegistrant[] }) {
  const { needsRide, selfTransport, unspecified } = splitByTransport(active)
  return (
    <>
      <TransportGroup title="Needs ride" rows={needsRide} emptyHint="No one has asked for a ride." />
      <TransportGroup title="Self-transport" rows={selfTransport} emptyHint="No one has opted to drive themselves." />
      {unspecified.length > 0 && (
        <TransportGroup
          title="Not specified"
          rows={unspecified}
          emptyHint=""
          note="Legacy bookings from before transport was a required question."
        />
      )}
    </>
  )
}

// ── 2. Event transport blurb (DiveTravel.transportation) ─────────────────────
function TransportTextEditor({ event, isAdmin }: { event: AppEvent; isAdmin: boolean }) {
  const [ref, setRef] = useState<string | null | undefined>(undefined) // undefined = loading
  const [text, setText] = useState(event.details?.transportation ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('EO_dives').select('DiveTravel_reference').eq('_id', event.id).maybeSingle()
      if (!cancelled) setRef((data as { DiveTravel_reference: string | null } | null)?.DiveTravel_reference ?? null)
    })()
    return () => { cancelled = true }
  }, [event.id])

  async function save() {
    if (!ref) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const { error: e } = await supabase
        .from('DiveTravel').update({ transportation: text.trim() || null }).eq('_id', ref)
      if (e) throw e
      setSaved(true)
    } catch {
      setError('Could not save the transport text.')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    if (!event.details?.transportation) return null
    return (
      <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-1">
        <h2 className="text-sm font-bold text-blue-900">Transport info</h2>
        <p className="text-sm text-blue-950 whitespace-pre-wrap">{event.details.transportation}</p>
      </div>
    )
  }

  return (
    <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-blue-900">Transport info</h2>
      {ref === null ? (
        <p className="text-xs text-blue-950/70 font-medium italic">
          No travel entry is linked to this dive — manage transport copy from the DiveTravel catalog.
        </p>
      ) : (
        <>
          <p className="text-xs text-blue-950/70 font-medium italic">
            Shown to divers in the booking form. This edits the shared travel entry, so it affects
            every dive that uses it.
          </p>
          <textarea
            aria-label="Transport info"
            value={text}
            disabled={ref === undefined || saving}
            onChange={e => { setText(e.target.value); setSaved(false) }}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-sky-300 text-sm text-blue-950 disabled:opacity-50"
            placeholder="How divers reach the site…"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={ref === undefined || saving}
              onClick={save}
              className="px-3 py-1 rounded-lg bg-blue-900 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs text-emerald-700 font-medium">Saved ✓</span>}
            {error && <span className="text-xs text-red-600 font-medium">{error}</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ── 3. Cars assigned to the dive on its date + ride seats ────────────────────
function DiveVehicleSection({ event, isAdmin, createdBy, riders }: {
  event: AppEvent; isAdmin: boolean; createdBy: string | null; riders: number
}) {
  const [dayKey, setDayKey] = useState<string | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [allocations, setAllocations] = useState<EventVehicle[]>([])
  const [reload, setReload] = useState(0)

  // A dive's allocations are keyed by its start_date (the day logistics shows
  // it on), so fetch that plain date rather than reconstructing it from the ISO
  // start_time (which can shift across the date line by timezone).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('EO_dives').select('start_date').eq('_id', event.id).maybeSingle()
      if (!cancelled) setDayKey((data as { start_date: string | null } | null)?.start_date ?? null)
    })()
    return () => { cancelled = true }
  }, [event.id])

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

  if (!dayKey) return null

  const activeVehicles = vehicles.filter(v => v.active)
  const vehicleMap = new Map(vehicles.map(v => [v.id, v]))
  const allocatedVehicleIds = new Set(allocations.map(a => a.vehicle_id))
  const available = availableVehicles(activeVehicles, allocatedVehicleIds)
  const mine = allocations.filter(a => allocationEventId(a) === event.id)
  const capacity = mine.reduce((s, a) => s + (vehicleMap.get(a.vehicle_id)?.passenger_seats ?? 0), 0)
  const short = capacity > 0 && riders > capacity

  return (
    <div className="space-y-2">
      <EventVehicleGroup
        event={{ id: event.id, type: 'dive' }}
        dayKey={dayKey}
        allocations={mine}
        available={available}
        vehicleMap={vehicleMap}
        riders={riders}
        isAdmin={isAdmin}
        createdBy={createdBy}
        onChanged={() => setReload(k => k + 1)}
      />
      {short && (
        <p className="text-xs text-red-600 font-semibold pl-1">
          Short {riders - capacity} seat{riders - capacity === 1 ? '' : 's'} — {riders} need a ride but only {capacity} assigned.
        </p>
      )}
    </div>
  )
}
