import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { splitByTransport } from '../../lib/logistics'
import { TransportGroup } from './TransportGroup'
import { EventCarAssignment } from './EventCarAssignment'
import { setBookingTransportation } from '../../lib/booking-transport'
import type { AppEvent, Booking, BookingDetails, Profile } from '../../types/database'
import { t } from '../../i18n'

const tp = t.admin.transport

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
 *  2. The dive's transport blurb (trip_templates.transportation) — a shared catalog
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
        <p className="text-xs text-brand-950/70 font-medium italic">{tp.cancelledHidden}</p>
      )}

      {isDive && (
        <>
          <TransportTextEditor event={event} isAdmin={isAdmin} />
          <EventCarAssignment
            event={{ id: event.id, type: event.type }}
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
    <div role="group" aria-label={tp.rideChoices} className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-brand-900">{tp.rideChoices}</h2>
      {active.length === 0 ? (
        <p className="text-xs text-brand-950/70 font-medium italic">{tp.noActiveRegistrants}</p>
      ) : (
        <ul className="divide-y divide-surface-200">
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
      <span className="text-sm text-brand-900 font-medium min-w-0">
        {row.profile?.name ?? tp.noProfile}
        {row.profile?.nickname && row.profile.nickname !== row.profile.name && (
          <span className="text-brand-900/80 font-medium"> ({row.profile.nickname})</span>
        )}
        {error && <span className="text-xs text-red-600 font-medium">{tp.saveFailedInline}</span>}
      </span>
      <span className="shrink-0 inline-flex rounded-lg overflow-hidden border border-surface-300">
        <SegBtn active={current === true}  disabled={busy} onClick={() => set(true)}>{tp.needsRide}</SegBtn>
        <SegBtn active={current === false} disabled={busy} onClick={() => set(false)}>{tp.self}</SegBtn>
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
        active ? 'bg-brand-900 text-white' : 'bg-white text-brand-900 hover:bg-surface-50'
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
      <TransportGroup title={tp.needsRide} rows={needsRide} emptyHint={tp.noOneNeedsRide} />
      <TransportGroup title={tp.selfTransport} rows={selfTransport} emptyHint={tp.noOneSelfDrives} />
      {unspecified.length > 0 && (
        <TransportGroup
          title={tp.notSpecified}
          rows={unspecified}
          emptyHint=""
          note={tp.unspecifiedNote}
        />
      )}
    </>
  )
}

// ── 2. Event transport blurb (trip_templates.transportation) ──────────────────
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
        .from('events').select('trip_template_id').eq('id', event.id).maybeSingle()
      if (!cancelled) setRef((data as { trip_template_id: string | null } | null)?.trip_template_id ?? null)
    })()
    return () => { cancelled = true }
  }, [event.id])

  async function save() {
    if (!ref) return
    setSaving(true); setError(null); setSaved(false)
    try {
      const { error: e } = await supabase
        .from('trip_templates').update({ transportation: text.trim() || null }).eq('id', ref)
      if (e) throw e
      setSaved(true)
    } catch {
      setError(tp.saveTextFailed)
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    if (!event.details?.transportation) return null
    return (
      <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-1">
        <h2 className="text-sm font-bold text-brand-900">{tp.transportInfo}</h2>
        <p className="text-sm text-brand-950 whitespace-pre-wrap">{event.details.transportation}</p>
      </div>
    )
  }

  return (
    <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-brand-900">{tp.transportInfo}</h2>
      {ref === null ? (
        <p className="text-xs text-brand-950/70 font-medium italic">{tp.noTripTemplate}</p>
      ) : (
        <>
          <p className="text-xs text-brand-950/70 font-medium italic">{tp.transportTextHint}</p>
          <textarea
            aria-label={tp.transportInfo}
            value={text}
            disabled={ref === undefined || saving}
            onChange={e => { setText(e.target.value); setSaved(false) }}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-surface-300 text-sm text-brand-950 disabled:opacity-50"
            placeholder={tp.transportTextPlaceholder}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={ref === undefined || saving}
              onClick={save}
              className="px-3 py-1 rounded-lg bg-brand-900 text-white text-xs font-semibold disabled:opacity-50"
            >
              {saving ? tp.saving : tp.save}
            </button>
            {saved && <span className="text-xs text-emerald-700 font-medium">{tp.saved}</span>}
            {error && <span className="text-xs text-red-600 font-medium">{error}</span>}
          </div>
        </>
      )}
    </div>
  )
}
