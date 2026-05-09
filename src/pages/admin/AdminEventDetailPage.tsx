import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { fetchEventsForBookings, formatEventSpan } from '../../lib/events'
import { AdminNotes } from '../../components/admin/AdminNotes'
import { AdminAddDiverModal } from '../../components/admin/AdminAddDiverModal'
import { EventStaffSection } from '../../components/admin/EventStaffSection'
import { RegisterForm } from '../../components/register/RegisterForm'
import { shoeAsJp } from '../../lib/shoe-size'
import { fetchAmendmentsForBookings, addAmendment, formAmount, amendmentsDelta } from '../../lib/booking-amendments'
import type { AppEvent, Booking, BookingAmendment, BookingDetails, Payment, Profile } from '../../types/database'

interface Registrant {
  booking: Booking
  profile: Profile | null
  payments: Payment[]
  amendments: BookingAmendment[]
}

type AddonNameMap = Map<string, string>
type RoomNameMap = Map<string, string>

export function AdminEventDetailPage() {
  const { type, id } = useParams<{ type: 'dive' | 'course'; id: string }>()
  const { profile } = useAuth()
  const toast = useToast()
  const isAdmin = profile?.role === 'admin'
  const [event, setEvent] = useState<AppEvent | null>(null)
  const [registrants, setRegistrants] = useState<Registrant[]>([])
  const [addonNames, setAddonNames] = useState<AddonNameMap>(new Map())
  const [roomNames, setRoomNames] = useState<RoomNameMap>(new Map())
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Registrant | null>(null)
  const [addDiverOpen, setAddDiverOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  // Cancel-event flow state. The modal opens on click; the actual update
  // runs only after the admin confirms in the modal.
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelInFlight, setCancelInFlight] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    if (!type || !id) return
    let cancelled = false
    ;(async () => {
      // Event info via helper
      const eventMap = await fetchEventsForBookings(
        type === 'dive' ? [id] : [],
        type === 'course' ? [id] : []
      )
      if (cancelled) return
      setEvent(eventMap.get(id) ?? null)

      // Bookings on this event
      const column = type === 'dive' ? 'eo_dive_id' : 'eo_course_id'
      const { data: bookings } = await supabase
        .from('bookings')
        .select('*')
        .eq(column, id)
        .order('created_at')

      if (cancelled) return
      if (!bookings?.length) { setRegistrants([]); setLoading(false); return }

      const userIds = [...new Set(bookings.map(b => b.user_id))]
      const bookingIds = bookings.map(b => b.id)

      const [profilesRes, paymentsRes, amendmentsByBooking] = await Promise.all([
        supabase.from('profiles').select('*').in('id', userIds),
        supabase.from('payments').select('*').in('booking_id', bookingIds),
        fetchAmendmentsForBookings(bookingIds),
      ])
      if (cancelled) return

      const profileMap = new Map((profilesRes.data ?? []).map(p => [p.id, p]))
      const paymentsByBooking = new Map<string, Payment[]>()
      for (const p of paymentsRes.data ?? []) {
        if (!p.booking_id) continue
        const arr = paymentsByBooking.get(p.booking_id) ?? []
        arr.push(p)
        paymentsByBooking.set(p.booking_id, arr)
      }

      // Resolve any add-on / room IDs referenced in the bookings to display
      // names so the admin doesn't see raw UUIDs.
      const addonIds = new Set<string>()
      const roomIds = new Set<string>()
      for (const b of bookings) {
        const d = b.details as BookingDetails
        for (const id of d.add_ons ?? []) addonIds.add(id)
        if (d.room?.option_id) roomIds.add(d.room.option_id)
      }
      const [addonRes, roomRes] = await Promise.all([
        addonIds.size
          ? supabase.from('Other_Addons').select('_id, display_title, admin_title').in('_id', [...addonIds])
          : Promise.resolve({ data: [] as { _id: string; display_title: string | null; admin_title: string | null }[] }),
        roomIds.size
          ? supabase.from('EO_rooms').select('_id, display_title, admin_title').in('_id', [...roomIds])
          : Promise.resolve({ data: [] as { _id: string; display_title: string | null; admin_title: string | null }[] }),
      ])
      if (cancelled) return
      setAddonNames(new Map((addonRes.data ?? []).map(a => [a._id, a.display_title || a.admin_title || a._id])))
      setRoomNames(new Map((roomRes.data ?? []).map(r => [r._id, r.display_title || r.admin_title || r._id])))

      setRegistrants(bookings.map(b => ({
        booking: b,
        profile: profileMap.get(b.user_id) ?? null,
        payments: paymentsByBooking.get(b.id) ?? [],
        amendments: amendmentsByBooking.get(b.id) ?? [],
      })))
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [type, id, refreshKey])

  async function updateStatus(bookingId: string, newStatus: Booking['status']) {
    await supabase.from('bookings').update({ status: newStatus }).eq('id', bookingId)
    setRegistrants(prev => prev.map(r =>
      r.booking.id === bookingId ? { ...r, booking: { ...r.booking, status: newStatus } } : r
    ))
  }

  async function approveRefund(bookingId: string) {
    // Processing the actual refund happens off-app (bank transfer etc.);
    // admin approval just marks the booking cancelled.
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    setRegistrants(prev => prev.map(r =>
      r.booking.id === bookingId ? { ...r, booking: { ...r.booking, status: 'cancelled' } } : r
    ))
  }

  async function submitAmendment(bookingId: string, sign: '+' | '-', amount: number, note: string) {
    if (!profile?.id) return
    try {
      const row = await addAmendment({
        bookingId,
        signedAmount: formAmount(sign, amount),
        note,
        createdBy: profile.id,
      })
      setRegistrants(prev => prev.map(r =>
        r.booking.id === bookingId ? { ...r, amendments: [...r.amendments, row] } : r
      ))
      toast.success('Amendment added.')
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function setCancelledAt(value: string | null) {
    if (!type || !id) return
    setCancelInFlight(true)
    setCancelError(null)
    try {
      const table = type === 'dive' ? 'EO_dives' : 'EO_courses'
      const { error } = await supabase
        .from(table)
        .update({ cancelled_at: value } as never)
        .eq('_id', id)
      if (error) throw error
      setEvent(prev => (prev ? { ...prev, cancelled_at: value } : prev))
      setCancelModalOpen(false)
      toast.success(value ? 'Event cancelled' : 'Event restored')
    } catch (err) {
      const msg = errorMessage(err)
      setCancelError(msg)
      toast.error(`Could not ${value ? 'cancel' : 'restore'} event: ${msg}`)
    } finally {
      setCancelInFlight(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to="/admin/events" className="text-sm text-white/70 hover:text-white">‹ back to events</Link>

      <header className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4">
        <h1 className="text-xl font-bold text-blue-900">{event?.title ?? '(event not found)'}</h1>
        {event && (
          <p className="text-sm text-blue-900 font-medium mt-1">
            {formatEventSpan(event, { style: 'long' })}
            {' · '}
            <span className="capitalize">{event.type}</span>
            {event.price != null && ` · From ${event.currency} ${event.price.toLocaleString()}`}
          </p>
        )}
        <p className="text-sm text-red-600 mt-2">{registrants.length} registrant{registrants.length === 1 ? '' : 's'}</p>
        {event?.cancelled_at && (
          <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-red-700 bg-red-50 border border-red-500 rounded px-2 py-1 inline-block">
            Cancelled {format(new Date(event.cancelled_at), 'MMM d, yyyy')}
          </p>
        )}
      </header>

      {type && id && (
        <>
          <div className="flex items-center justify-end gap-2">
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => setAddDiverOpen(true)}
                  className="text-xs bg-emerald-900/60 hover:bg-emerald-900 text-white px-3 py-1 rounded-lg"
                >
                  Add diver
                </button>
                <Link
                  to={`/admin/events/${type}/${id}/edit`}
                  className="text-xs bg-blue-900/60 hover:bg-blue-900 text-white px-3 py-1 rounded-lg"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => { setCancelError(null); setCancelModalOpen(true) }}
                  className="text-xs bg-red-900/60 hover:bg-red-900 text-white px-3 py-1 rounded-lg"
                >
                  {event?.cancelled_at ? 'Restore event' : 'Cancel event'}
                </button>
              </>
            )}
            <Link
              to={`/admin/events/${type}/${id}/gear-map`}
              className="text-xs bg-sky-900/50 hover:bg-sky-900 text-sky-200 px-3 py-1 rounded-lg"
            >
              Gear map →
            </Link>
          </div>
          {event && (
            <EventStaffSection
              eventType={type}
              eventId={id}
              eventStartDate={event.start_time}
              eventEndDate={event.end_time}
              nonAdminDiverCount={registrants.length}
              readOnly={!isAdmin}
            />
          )}
          <AdminNotes target={{ kind: type, id }} title="Memos" />
        </>
      )}

      {registrants.length === 0 ? (
        <p className="text-blue-950 font-medium text-sm">No one has registered for this event yet.</p>
      ) : (
        <section className="space-y-2">
          {registrants.map(r => (
            <RegistrantCard
              key={r.booking.id}
              r={r}
              addonNames={addonNames}
              roomNames={roomNames}
              onStatusChange={updateStatus}
              onApproveRefund={approveRefund}
              onEdit={() => setEditing(r)}
              onAddAmendment={submitAmendment}
              readOnly={!isAdmin}
            />
          ))}
        </section>
      )}

      {editing && event && (
        <RegisterForm
          event={event}
          profile={editing.profile}
          userId={editing.booking.user_id}
          existingBooking={editing.booking}
          onClose={() => setEditing(null)}
          onBooked={updated => {
            const b = updated as Booking
            setRegistrants(prev => prev.map(r =>
              r.booking.id === b.id ? { ...r, booking: b } : r
            ))
            setEditing(null)
          }}
        />
      )}

      {addDiverOpen && event && (
        <AdminAddDiverModal
          event={event}
          onClose={() => setAddDiverOpen(false)}
          onAdded={() => {
            toast.success('Diver registered for this event')
            setRefreshKey(k => k + 1)
          }}
        />
      )}

      {cancelModalOpen && (
        <CancelEventModal
          alreadyCancelled={!!event?.cancelled_at}
          activeBookingCount={registrants.filter(r => r.booking.status !== 'cancelled').length}
          inFlight={cancelInFlight}
          error={cancelError}
          onClose={() => setCancelModalOpen(false)}
          onConfirm={() => setCancelledAt(event?.cancelled_at ? null : new Date().toISOString())}
        />
      )}
    </div>
  )
}

function CancelEventModal({
  alreadyCancelled, activeBookingCount, inFlight, error, onClose, onConfirm,
}: {
  alreadyCancelled: boolean
  activeBookingCount: number
  inFlight: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-event-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-3">
        <h2 id="cancel-event-title" className="text-lg font-bold text-blue-900">
          {alreadyCancelled ? 'Restore event?' : 'Cancel event?'}
        </h2>
        {alreadyCancelled ? (
          <p className="text-sm text-blue-900">
            This will make the event visible on the calendar again. Existing
            bookings remain attached.
          </p>
        ) : (
          <>
            <p className="text-sm text-blue-900">
              The event will be hidden from the calendar and listing pages.
              Existing bookings stay attached so refund records remain
              traceable.
            </p>
            {activeBookingCount > 0 && (
              <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-500 rounded px-3 py-2">
                {activeBookingCount} active booking{activeBookingCount === 1 ? '' : 's'} on this event will need refunds. Issue them in Stripe separately.
              </p>
            )}
          </>
        )}
        {error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-500 rounded px-2 py-1">{error}</p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={inFlight}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-blue-900 border border-sky-300 hover:bg-sky-50 disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={inFlight}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 ${
              alreadyCancelled
                ? 'bg-blue-900 hover:bg-blue-950'
                : 'bg-red-700 hover:bg-red-800'
            }`}
          >
            {inFlight
              ? (alreadyCancelled ? 'Restoring…' : 'Cancelling…')
              : (alreadyCancelled ? 'Restore event' : 'Cancel event')}
          </button>
        </div>
      </div>
    </div>
  )
}

const BOOKING_STATUSES: Booking['status'][] = ['pending', 'confirmed', 'waitlisted', 'cancelled']

function RegistrantCard({ r, addonNames, roomNames, onStatusChange, onApproveRefund, onEdit, onAddAmendment, readOnly }: {
  r: Registrant
  addonNames: AddonNameMap
  roomNames: RoomNameMap
  onStatusChange: (id: string, s: Booking['status']) => void
  onApproveRefund: (id: string) => void
  onEdit: () => void
  onAddAmendment: (id: string, sign: '+' | '-', amount: number, note: string) => Promise<void>
  readOnly?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  const totalPaid = r.payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const totalDue = r.payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0)
  const paymentStatus = r.payments.length === 0
    ? 'none'
    : totalDue > 0 ? 'partial' : 'paid'
  const baseTotal = Number((r.booking.details as { total?: number } | undefined)?.total ?? 0)
  const adjusted = baseTotal + amendmentsDelta(r.amendments)

  const statusStyles: Record<string, string> = {
    confirmed:  'text-blue-900 font-semibold',
    pending:    'text-red-600',
    cancelled:  'text-blue-950 font-medium line-through',
    waitlisted: 'text-violet-400',
  }
  const payStyles: Record<string, string> = {
    paid:    'text-blue-900 font-semibold',
    partial: 'text-red-600',
    none:    'text-blue-950 font-medium',
  }

  return (
    <div className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="w-full text-left flex items-start justify-between gap-3 focus:outline-none"
      >
        <div>
          <p className="font-medium text-blue-900 text-sm">
            <span aria-hidden="true" className="text-blue-950 font-medium mr-1.5">{expanded ? '▾' : '▸'}</span>
            {r.profile?.full_name ?? '(no profile)'}
            {r.profile?.display_name && <span className="text-blue-900 font-medium"> “{r.profile.display_name}”</span>}
            {r.profile?.name_alt && <span className="text-blue-900 font-medium"> ({r.profile.name_alt})</span>}
          </p>
          {r.profile && (
            <p className="text-xs text-blue-900 font-medium pl-4">
              {r.profile.cert_agency && r.profile.cert_level && `${r.profile.cert_agency} ${r.profile.cert_level}`}
              {r.profile.nitrox_certified && ' · Nitrox'}
            </p>
          )}
        </div>
        <div className="text-right text-xs shrink-0 space-y-1">
          {/* Wrapped in a click-stopper so opening the select doesn't collapse/expand the card. */}
          {readOnly ? (
            <span className={`bg-white border border-sky-300 rounded px-1.5 py-0.5 text-xs font-medium capitalize inline-block ${statusStyles[r.booking.status]}`}>
              {r.booking.status}
            </span>
          ) : (
            <span onClick={e => e.stopPropagation()}>
              <select
                value={r.booking.status}
                onChange={e => onStatusChange(r.booking.id, e.target.value as Booking['status'])}
                className={`bg-white border border-sky-300 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${statusStyles[r.booking.status]}`}
              >
                {BOOKING_STATUSES.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </span>
          )}
          <p className={`${payStyles[paymentStatus]} capitalize`}>
            {paymentStatus === 'paid'    && `Paid ${totalPaid.toLocaleString()}`}
            {paymentStatus === 'partial' && `${totalPaid.toLocaleString()} paid · ${totalDue.toLocaleString()} due`}
            {paymentStatus === 'none'    && 'No payment'}
          </p>
        </div>
      </button>

      {expanded && (
        <>
          {r.profile && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-blue-900 font-medium pt-1 border-t border-sky-200">
              {r.profile.phone       && <span>📞 {r.profile.phone}</span>}
              {r.profile.contact_method && r.profile.contact_id && (
                <span>{methodEmoji(r.profile.contact_method)} {r.profile.contact_id}</span>
              )}
              {r.profile.logged_dives > 0 && <span>📖 {r.profile.logged_dives} logged</span>}
              {r.profile.height_cm && r.profile.weight_kg && (
                <span>📏 {r.profile.height_cm}cm / {r.profile.weight_kg}kg</span>
              )}
              {r.profile.shoe_size && (
                <span>👟 {shoeAsJp(r.profile.shoe_size) ?? r.profile.shoe_size}</span>
              )}
            </div>
          )}

          {renderDetails(r.booking.details, { addonNames, roomNames }) && (
            <div className="text-xs text-blue-950 font-medium bg-sky-50 rounded p-2 space-y-1">
              {renderDetails(r.booking.details, { addonNames, roomNames })}
            </div>
          )}

          {r.booking.refund_requested_at && r.booking.status !== 'cancelled' && (
            <div className="flex items-center justify-between text-xs bg-red-50 border border-red-500 rounded p-2">
              <span className="text-red-600">
                🔄 Refund requested {format(new Date(r.booking.refund_requested_at), 'MMM d, HH:mm')}
              </span>
              {!readOnly && (
                <button
                  onClick={() => onApproveRefund(r.booking.id)}
                  className="bg-blue-900 hover:bg-blue-950 text-white text-xs font-semibold px-2 py-1 rounded"
                >
                  Approve refund
                </button>
              )}
            </div>
          )}

          {r.booking.notes && (
            <p className="text-xs text-blue-950 font-medium bg-sky-50 rounded p-2">📝 {r.booking.notes}</p>
          )}

          <AmendmentsSection
            amendments={r.amendments}
            baseTotal={baseTotal}
            adjusted={adjusted}
            readOnly={!!readOnly}
            onAdd={(sign, amount, note) => onAddAmendment(r.booking.id, sign, amount, note)}
          />

          {!readOnly && (
            <div className="flex justify-end pt-1">
              <button
                onClick={onEdit}
                className="text-xs bg-sky-100 hover:bg-sky-700 text-blue-900 font-semibold px-3 py-1 rounded"
              >
                Edit registration
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function AmendmentsSection({ amendments, baseTotal, adjusted, readOnly, onAdd }: {
  amendments: BookingAmendment[]
  baseTotal: number
  adjusted: number
  readOnly: boolean
  onAdd: (sign: '+' | '-', amount: number, note: string) => Promise<void>
}) {
  const [sign, setSign] = useState<'+' | '-'>('+')
  const [amountStr, setAmountStr] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = parseInt(amountStr, 10)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Amount must be a positive integer.')
      return
    }
    if (!note.trim()) {
      setError('A note is required.')
      return
    }
    setSubmitting(true)
    try {
      await onAdd(sign, amount, note.trim())
      setAmountStr('')
      setNote('')
      setSign('+')
    } finally {
      setSubmitting(false)
    }
  }

  if (amendments.length === 0 && readOnly) return null

  return (
    <div className="text-xs bg-sky-50 rounded p-2 space-y-2">
      <p className="font-semibold text-blue-900">Balance amendments</p>
      {amendments.length === 0 ? (
        <p className="text-blue-900 font-medium italic">No amendments yet.</p>
      ) : (
        <ul className="space-y-1">
          {amendments.map(a => (
            <li key={a.id} className="flex items-baseline justify-between gap-2">
              <span className="text-blue-950 font-medium flex-1">{a.note}</span>
              <span className={`shrink-0 font-semibold ${a.amount >= 0 ? 'text-red-600' : 'text-blue-900'}`}>
                {a.amount >= 0 ? '+' : '−'}{Math.abs(a.amount).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
      {amendments.length > 0 && baseTotal > 0 && (
        <p className="text-blue-900 font-medium pt-1 border-t border-sky-200 flex items-baseline justify-between">
          <span>Adjusted total</span>
          <span className="font-semibold">{adjusted.toLocaleString()}</span>
        </p>
      )}

      {!readOnly && (
        <form onSubmit={handleSubmit} className="space-y-1.5 pt-1 border-t border-sky-200">
          <div className="flex items-center gap-2">
            <select
              value={sign}
              onChange={e => setSign(e.target.value as '+' | '-')}
              className="bg-white border border-sky-300 rounded px-1.5 py-0.5 text-xs font-semibold text-blue-900"
            >
              <option value="+">+ owes more</option>
              <option value="-">− owes less</option>
            </select>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={amountStr}
              onChange={e => setAmountStr(e.target.value)}
              placeholder="Amount"
              className="flex-1 bg-white border border-sky-300 rounded px-2 py-0.5 text-xs text-blue-900"
            />
          </div>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Reason (required)"
            maxLength={1000}
            className="w-full bg-white border border-sky-300 rounded px-2 py-0.5 text-xs text-blue-900"
          />
          {error && <p className="text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="text-xs bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white font-semibold px-3 py-1 rounded"
            >
              {submitting ? 'Adding…' : 'Add amendment'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function renderDetails(d: BookingDetails, names: { addonNames: AddonNameMap; roomNames: RoomNameMap }) {
  const bits: React.ReactNode[] = []
  if (d.gear?.rent) {
    const items = d.gear.items?.length ? ` (${d.gear.items.join(', ')})` : ''
    bits.push(<p key="gear">🧰 Gear: {d.gear.mode ?? 'full'}{items}</p>)
  }
  if (d.room?.option_id) {
    const roomLabel = names.roomNames.get(d.room.option_id) ?? d.room.option_id
    bits.push(<p key="room">🛏️ Room: {roomLabel}{d.room.notes ? ` · ${d.room.notes}` : ''}</p>)
  }
  if (d.add_ons?.length) {
    const labels = d.add_ons.map(id => names.addonNames.get(id) ?? id)
    bits.push(<p key="addons">➕ Add-ons: {labels.join(', ')}</p>)
  }
  if (d.transportation) bits.push(<p key="transport">🚐 Needs ride</p>)
  if (d.nitrox_course_addon) bits.push(<p key="nitrox">🟢 Nitrox course add-on</p>)
  if (d.payment_method) bits.push(<p key="pay">💳 {d.payment_method.replace('_', ' ')}</p>)
  if (d.total != null) bits.push(<p key="total">Total: {d.total.toLocaleString()}{d.deposit != null && ` · Deposit ${d.deposit.toLocaleString()}`}</p>)
  return bits.length ? bits : null
}

function methodEmoji(m: NonNullable<Profile['contact_method']>) {
  return m === 'whatsapp' ? '🟢' : m === 'line' ? '🟩' : m === 'phone' ? '📞' : '✉️'
}
