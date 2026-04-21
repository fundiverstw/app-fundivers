import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings } from '../lib/events'
import type { AppEvent, Booking, Payment } from '../types/database'

interface BookingLine {
  booking: Booking
  event: AppEvent | null
  /** Total from booking.details.total (0 if not set). */
  total: number
  /** Sum of matched paid payments. */
  paid: number
  /** total - paid, never negative. */
  due: number
}

const PAYMENT_STATUS_STYLES: Record<Payment['status'], string> = {
  pending: 'text-amber-400',
  paid: 'text-emerald-400',
  refunded: 'text-slate-400',
}

export function PaymentsPage() {
  const { user } = useAuth()
  const [lines, setLines] = useState<BookingLine[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const [bookingsRes, paymentsRes] = await Promise.all([
        supabase.from('bookings').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('payments').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ])
      if (cancelled) return
      const bookings = bookingsRes.data ?? []
      const payRows = (paymentsRes.data ?? []) as Payment[]
      setPayments(payRows)

      const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
      const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
      const eventMap = (diveIds.length || courseIds.length)
        ? await fetchEventsForBookings(diveIds, courseIds)
        : new Map<string, AppEvent>()
      if (cancelled) return

      const paidByBooking = new Map<string, number>()
      for (const p of payRows) {
        if (!p.booking_id || p.status !== 'paid') continue
        paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + p.amount)
      }

      setLines(bookings.map(b => {
        const eventId = b.eo_dive_id ?? b.eo_course_id ?? ''
        const total = Number((b.details as { total?: number } | undefined)?.total ?? 0)
        const paid = paidByBooking.get(b.id) ?? 0
        return {
          booking: b,
          event: eventMap.get(eventId) ?? null,
          total,
          paid,
          due: Math.max(0, total - paid),
        }
      }))
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [user])

  const active = lines.filter(l => l.booking.status !== 'cancelled')
  const totalOwed = active.reduce((s, l) => s + l.due, 0)
  const totalPaid = active.reduce((s, l) => s + l.paid, 0)
  const currency = lines.find(l => l.event)?.event?.currency ?? 'TWD'

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Payments</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Balance due</p>
          <p className="text-2xl font-bold text-amber-400">{currency} {totalOwed.toLocaleString()}</p>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Total paid</p>
          <p className="text-2xl font-bold text-emerald-400">{currency} {totalPaid.toLocaleString()}</p>
        </div>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Per booking</h2>
        {active.length === 0 ? (
          <p className="text-slate-500 text-sm">No active bookings yet. Check the calendar!</p>
        ) : (
          <div className="space-y-2">
            {active.map(l => <BookingLineCard key={l.booking.id} line={l} currency={currency} />)}
          </div>
        )}
      </section>

      {payments.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Payment history</h2>
          <div className="space-y-2">
            {payments.map(p => (
              <div key={p.id} className="bg-slate-800 rounded-xl p-4 flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm text-slate-100">{p.note ?? 'Payment'}</p>
                  <p className="text-xs text-slate-400">
                    {format(new Date(p.created_at), 'MMM d, yyyy')}
                    {p.method && ` · ${p.method}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-100">{p.currency} {p.amount.toLocaleString()}</p>
                  <p className={`text-xs font-medium capitalize ${PAYMENT_STATUS_STYLES[p.status]}`}>{p.status}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-slate-500 text-center">
        Totals reflect booking selections. Final amounts are confirmed by FunDivers staff.
      </p>
    </div>
  )
}

const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-amber-400',
  confirmed: 'text-emerald-400',
  cancelled: 'text-slate-500',
  waitlisted: 'text-violet-400',
}

function BookingLineCard({ line, currency }: { line: BookingLine; currency: string }) {
  const { booking, event, total, paid, due } = line
  const label = event?.title ?? '(event)'
  const details = booking.details
  const deposit = Number((details as { deposit?: number }).deposit ?? 0)
  const depositOutstanding = deposit > 0 && paid < deposit

  const breakdown: string[] = []
  if (event?.price != null) breakdown.push('Base')
  if (details.gear?.rent) breakdown.push(`Gear (${details.gear.mode ?? 'full'})`)
  if (details.room?.option_id) breakdown.push('Room')
  if ((details.add_ons?.length ?? 0) > 0) breakdown.push(`${details.add_ons!.length} add-on${details.add_ons!.length === 1 ? '' : 's'}`)
  if (details.transportation) breakdown.push('Transportation')
  if (details.nitrox_course_addon) breakdown.push('Nitrox course')

  return (
    <div className="bg-slate-800 rounded-xl p-4 space-y-1">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-slate-100 text-sm">{label}</p>
          {event && (
            <p className="text-xs text-slate-400">{format(new Date(event.start_time), 'EEE, MMM d yyyy · HH:mm')}</p>
          )}
          {breakdown.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">{breakdown.join(' · ')}</p>
          )}
          <p className={`text-xs capitalize mt-1 font-medium ${STATUS_STYLES[booking.status]}`}>
            {booking.status}
          </p>
        </div>
        <div className="text-right shrink-0">
          {total > 0 ? (
            <>
              <p className="text-sm font-semibold text-slate-100">{currency} {total.toLocaleString()}</p>
              {deposit > 0 && (
                <p className={`text-xs ${depositOutstanding ? 'text-amber-400' : 'text-emerald-400'}`}>
                  Deposit {currency} {deposit.toLocaleString()} {depositOutstanding ? 'due' : '✓'}
                </p>
              )}
              {paid > 0 && (
                <p className="text-xs text-emerald-400">{currency} {paid.toLocaleString()} paid</p>
              )}
              {due > 0 && (
                <p className="text-xs text-amber-400">{currency} {due.toLocaleString()} balance</p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">—</p>
          )}
        </div>
      </div>
    </div>
  )
}
