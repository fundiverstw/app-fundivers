import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings } from '../lib/events'
import type { AppEvent, Booking, Payment } from '../types/database'

type Row = Booking & {
  event: AppEvent | null
  payments: Payment[]
  paidSum: number
}

const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-amber-400',
  confirmed: 'text-emerald-400',
  cancelled: 'text-slate-500 line-through',
  waitlisted: 'text-violet-400',
}

export function BookingsPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function refetch(uid: string) {
    const [bookingsRes, paymentsRes] = await Promise.all([
      supabase.from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('user_id', uid),
    ])
    const bookings = bookingsRes.data ?? []
    const payments = (paymentsRes.data ?? []) as Payment[]

    const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
    const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
    const eventMap = (diveIds.length || courseIds.length)
      ? await fetchEventsForBookings(diveIds, courseIds)
      : new Map<string, AppEvent>()

    const paymentsByBooking = new Map<string, Payment[]>()
    for (const p of payments) {
      if (!p.booking_id) continue
      const arr = paymentsByBooking.get(p.booking_id) ?? []
      arr.push(p)
      paymentsByBooking.set(p.booking_id, arr)
    }

    setRows(bookings.map(b => {
      const bookingPayments = paymentsByBooking.get(b.id) ?? []
      const paidSum = bookingPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
      return {
        ...b,
        event: eventMap.get((b.eo_dive_id ?? b.eo_course_id)!) ?? null,
        payments: bookingPayments,
        paidSum,
      }
    }))
    setLoading(false)
  }

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      if (!cancelled) await refetch(user.id)
    })()
    return () => { cancelled = true }
  }, [user])

  async function cancelBooking(id: string) {
    await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', id)
    if (user) await refetch(user.id)
  }

  async function requestRefund(id: string) {
    await supabase.from('bookings').update({ refund_requested_at: new Date().toISOString() }).eq('id', id)
    if (user) await refetch(user.id)
  }

  const upcoming = rows.filter(r =>
    r.status !== 'cancelled' && r.event && new Date(r.event.start_time) >= new Date()
  )
  const past = rows.filter(r =>
    r.status === 'cancelled' || !r.event || new Date(r.event.start_time) < new Date()
  )

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">My Bookings</h1>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Upcoming</h2>
        {upcoming.length === 0
          ? <p className="text-slate-500 text-sm">No upcoming bookings. Check the calendar!</p>
          : <div className="space-y-2">
              {upcoming.map(r => (
                <Card
                  key={r.id}
                  row={r}
                  open={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                  onCancel={cancelBooking}
                  onRefund={requestRefund}
                />
              ))}
            </div>
        }
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Past / Cancelled</h2>
          <div className="space-y-2">
            {past.map(r => (
              <Card
                key={r.id}
                row={r}
                open={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                onCancel={cancelBooking}
                onRefund={requestRefund}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Card({
  row, open, onToggle, onCancel, onRefund,
}: {
  row: Row
  open: boolean
  onToggle: () => void
  onCancel: (id: string) => void
  onRefund: (id: string) => void
}) {
  const details = (row.details ?? {}) as Booking['details']
  const total = Number((details as { total?: number } | undefined)?.total ?? 0)
  const deposit = Number((details as { deposit?: number } | undefined)?.deposit ?? 0)
  const canCancel = row.status === 'pending' && row.paidSum === 0 && !row.refund_requested_at
  const canRefund = row.paidSum > 0 && row.status !== 'cancelled' && !row.refund_requested_at

  return (
    <div className="bg-slate-800 rounded-xl">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-slate-700/50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-100 text-sm">
            {row.event?.title ?? '(event unavailable)'}
          </p>
          {row.event && (
            <p className="text-xs text-slate-400 mt-0.5">
              {format(new Date(row.event.start_time), 'EEE, MMM d yyyy · HH:mm')}
              {' · '}
              {row.event.type === 'dive' ? 'Dive' : 'Course'}
            </p>
          )}
          {row.refund_requested_at && (
            <p className="text-xs text-amber-300 mt-0.5">🔄 Refund requested {format(new Date(row.refund_requested_at), 'MMM d')}</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className={`text-xs font-medium capitalize ${STATUS_STYLES[row.status]}`}>{row.status}</span>
          <p className="text-xs text-slate-500 mt-0.5">{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700 pt-3 space-y-3 text-sm">
          {total > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>Total</span>
              <span className="font-semibold">{row.event?.currency ?? 'TWD'} {total.toLocaleString()}</span>
            </div>
          )}
          {deposit > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>Deposit</span>
              <span className={row.paidSum >= deposit ? 'text-emerald-400' : 'text-amber-400'}>
                {row.event?.currency ?? 'TWD'} {deposit.toLocaleString()} {row.paidSum >= deposit ? '✓' : 'due'}
              </span>
            </div>
          )}
          {row.paidSum > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>Paid so far</span>
              <span className="text-emerald-400">{row.event?.currency ?? 'TWD'} {row.paidSum.toLocaleString()}</span>
            </div>
          )}

          <Breakdown details={details} />

          {row.notes && (
            <p className="text-xs text-slate-400 bg-slate-900/40 rounded p-2">📝 {row.notes}</p>
          )}
          <p className="text-xs text-slate-500">
            Booked {format(new Date(row.created_at), 'MMM d, yyyy')}
          </p>

          <div className="flex gap-2 pt-1">
            {canCancel && (
              <button
                onClick={() => onCancel(row.id)}
                className="flex-1 bg-slate-700 hover:bg-rose-900 text-slate-200 text-xs font-semibold py-2 px-3 rounded-lg transition-colors"
              >
                Cancel booking
              </button>
            )}
            {canRefund && (
              <button
                onClick={() => onRefund(row.id)}
                className="flex-1 bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold py-2 px-3 rounded-lg transition-colors"
              >
                Request refund
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Breakdown({ details }: { details: Booking['details'] | undefined }) {
  const d = details ?? {}
  const items: Array<[string, string | null]> = []
  if (d.gear?.rent) {
    const extras = d.gear.items?.length ? d.gear.items.join(', ') : null
    items.push([`Gear (${d.gear.mode ?? 'full'})`, extras])
  }
  if (d.room?.option_id) items.push(['Room', d.room.notes ?? null])
  if ((d.add_ons?.length ?? 0) > 0) items.push([`${d.add_ons!.length} add-on(s)`, null])
  if (d.transportation) items.push(['Transportation', null])
  if (d.nitrox_course_addon) items.push(['Nitrox course add-on', null])
  if (d.payment_method) items.push(['Payment', d.payment_method.replace('_', ' ')])

  if (items.length === 0) return null
  return (
    <div className="text-xs text-slate-400 space-y-0.5">
      {items.map(([label, extra]) => (
        <p key={label}>{label}{extra && <span className="text-slate-500"> — {extra}</span>}</p>
      ))}
    </div>
  )
}
