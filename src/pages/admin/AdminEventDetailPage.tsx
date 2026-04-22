import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { fetchEventsForBookings } from '../../lib/events'
import { AdminNotes } from '../../components/admin/AdminNotes'
import type { AppEvent, Booking, BookingDetails, Payment, Profile } from '../../types/database'

interface Registrant {
  booking: Booking
  profile: Profile | null
  payments: Payment[]
}

export function AdminEventDetailPage() {
  const { type, id } = useParams<{ type: 'dive' | 'course'; id: string }>()
  const [event, setEvent] = useState<AppEvent | null>(null)
  const [registrants, setRegistrants] = useState<Registrant[]>([])
  const [loading, setLoading] = useState(true)

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

      const [profilesRes, paymentsRes] = await Promise.all([
        supabase.from('profiles').select('*').in('id', userIds),
        supabase.from('payments').select('*').in('booking_id', bookingIds),
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

      setRegistrants(bookings.map(b => ({
        booking: b,
        profile: profileMap.get(b.user_id) ?? null,
        payments: paymentsByBooking.get(b.id) ?? [],
      })))
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [type, id])

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

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to="/admin/events" className="text-sm text-slate-400 hover:text-slate-100">‹ back to events</Link>

      <header className="bg-slate-800 rounded-xl p-4">
        <h1 className="text-xl font-bold text-slate-100">{event?.title ?? '(event not found)'}</h1>
        {event && (
          <p className="text-sm text-slate-400 mt-1">
            {format(new Date(event.start_time), 'EEEE, MMMM d · HH:mm')}
            {event.end_time && ` → ${format(new Date(event.end_time), 'MMMM d')}`}
            {' · '}
            <span className="capitalize">{event.type}</span>
            {event.price != null && ` · From ${event.currency} ${event.price.toLocaleString()}`}
          </p>
        )}
        <p className="text-sm text-amber-400 mt-2">{registrants.length} registrant{registrants.length === 1 ? '' : 's'}</p>
      </header>

      {type && id && (
        <>
          <div className="flex items-center justify-end">
            <Link
              to={`/admin/events/${type}/${id}/gear-map`}
              className="text-xs bg-sky-900/50 hover:bg-sky-900 text-sky-200 px-3 py-1 rounded-lg"
            >
              Gear map →
            </Link>
          </div>
          <AdminNotes target={{ kind: type, id }} title="Memos" />
        </>
      )}

      {registrants.length === 0 ? (
        <p className="text-slate-500 text-sm">No one has registered for this event yet.</p>
      ) : (
        <section className="space-y-2">
          {registrants.map(r => (
            <RegistrantCard
              key={r.booking.id}
              r={r}
              onStatusChange={updateStatus}
              onApproveRefund={approveRefund}
            />
          ))}
        </section>
      )}
    </div>
  )
}

const BOOKING_STATUSES: Booking['status'][] = ['pending', 'confirmed', 'waitlisted', 'cancelled']

function RegistrantCard({ r, onStatusChange, onApproveRefund }: {
  r: Registrant
  onStatusChange: (id: string, s: Booking['status']) => void
  onApproveRefund: (id: string) => void
}) {
  const totalPaid = r.payments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
  const totalDue = r.payments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0)
  const paymentStatus = r.payments.length === 0
    ? 'none'
    : totalDue > 0 ? 'partial' : 'paid'

  const statusStyles: Record<string, string> = {
    confirmed:  'text-emerald-400',
    pending:    'text-amber-400',
    cancelled:  'text-slate-500 line-through',
    waitlisted: 'text-violet-400',
  }
  const payStyles: Record<string, string> = {
    paid:    'text-emerald-400',
    partial: 'text-amber-400',
    none:    'text-slate-500',
  }

  return (
    <div className="bg-slate-800 rounded-xl p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-slate-100 text-sm">
            {r.profile?.full_name ?? '(no profile)'}
            {r.profile?.display_name && <span className="text-slate-400"> “{r.profile.display_name}”</span>}
          </p>
          {r.profile && (
            <p className="text-xs text-slate-400">
              {r.profile.cert_agency && r.profile.cert_level && `${r.profile.cert_agency} ${r.profile.cert_level}`}
              {r.profile.logged_dives > 0 && ` · ${r.profile.logged_dives} logged dives`}
              {r.profile.nitrox_certified && ' · Nitrox'}
            </p>
          )}
        </div>
        <div className="text-right text-xs shrink-0 space-y-1">
          <select
            value={r.booking.status}
            onChange={e => onStatusChange(r.booking.id, e.target.value as Booking['status'])}
            className={`bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${statusStyles[r.booking.status]}`}
          >
            {BOOKING_STATUSES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <p className={`${payStyles[paymentStatus]} capitalize`}>
            {paymentStatus === 'paid'    && `Paid ${totalPaid.toLocaleString()}`}
            {paymentStatus === 'partial' && `${totalPaid.toLocaleString()} paid · ${totalDue.toLocaleString()} due`}
            {paymentStatus === 'none'    && 'No payment'}
          </p>
        </div>
      </div>

      {r.profile && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400 pt-1 border-t border-slate-700">
          {r.profile.phone       && <span>📞 {r.profile.phone}</span>}
          {r.profile.contact_method && r.profile.contact_id && (
            <span>{methodEmoji(r.profile.contact_method)} {r.profile.contact_id}</span>
          )}
          {r.profile.height_cm && r.profile.weight_kg && (
            <span>📏 {r.profile.height_cm}cm / {r.profile.weight_kg}kg</span>
          )}
          {r.profile.shoe_size && <span>👟 {r.profile.shoe_size}</span>}
        </div>
      )}

      {renderDetails(r.booking.details) && (
        <div className="text-xs text-slate-300 bg-slate-900/40 rounded p-2 space-y-1">
          {renderDetails(r.booking.details)}
        </div>
      )}

      {r.booking.refund_requested_at && r.booking.status !== 'cancelled' && (
        <div className="flex items-center justify-between text-xs bg-amber-950/50 border border-amber-900 rounded p-2">
          <span className="text-amber-300">
            🔄 Refund requested {format(new Date(r.booking.refund_requested_at), 'MMM d, HH:mm')}
          </span>
          <button
            onClick={() => onApproveRefund(r.booking.id)}
            className="bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold px-2 py-1 rounded"
          >
            Approve refund
          </button>
        </div>
      )}

      {r.booking.notes && (
        <p className="text-xs text-slate-300 bg-slate-900/40 rounded p-2">📝 {r.booking.notes}</p>
      )}
    </div>
  )
}

function renderDetails(d: BookingDetails) {
  const bits: React.ReactNode[] = []
  if (d.gear?.rent) {
    const items = d.gear.items?.length ? ` (${d.gear.items.join(', ')})` : ''
    bits.push(<p key="gear">🧰 Gear: {d.gear.mode ?? 'full'}{items}</p>)
  }
  if (d.room?.option_id) {
    bits.push(<p key="room">🛏️ Room: {d.room.option_id}{d.room.notes ? ` · ${d.room.notes}` : ''}</p>)
  }
  if (d.add_ons?.length) {
    bits.push(<p key="addons">➕ Add-ons: {d.add_ons.join(', ')}</p>)
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
