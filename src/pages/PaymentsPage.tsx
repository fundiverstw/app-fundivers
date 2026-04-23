import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings, formatEventSpan } from '../lib/events'
import type { AppEvent, Booking, Payment } from '../types/database'

interface BookingLine {
  booking: Booking
  event: AppEvent | null
  payments: Payment[]
  total: number
  deposit: number
  paid: number
  due: number
  depositDue: number
}

const PAYMENT_STATUS_STYLES: Record<Payment['status'], string> = {
  pending: 'text-amber-400',
  paid: 'text-emerald-400',
  refunded: 'text-slate-400',
}

const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-amber-400',
  confirmed: 'text-emerald-400',
  cancelled: 'text-slate-500',
  waitlisted: 'text-violet-400',
}

export function PaymentsPage() {
  const { user } = useAuth()
  const [lines, setLines] = useState<BookingLine[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function refetch(uid: string) {
    const [bookingsRes, paymentsRes] = await Promise.all([
      supabase.from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
    ])
    const bookings = bookingsRes.data ?? []
    const payRows = (paymentsRes.data ?? []) as Payment[]

    const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
    const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
    const eventMap = (diveIds.length || courseIds.length)
      ? await fetchEventsForBookings(diveIds, courseIds)
      : new Map<string, AppEvent>()

    const paymentsByBooking = new Map<string, Payment[]>()
    for (const p of payRows) {
      if (!p.booking_id) continue
      const arr = paymentsByBooking.get(p.booking_id) ?? []
      arr.push(p)
      paymentsByBooking.set(p.booking_id, arr)
    }

    setLines(bookings.map(b => {
      const eventId = b.eo_dive_id ?? b.eo_course_id ?? ''
      const d = (b.details ?? {}) as { total?: number; deposit?: number }
      const total = Number(d.total ?? 0)
      const deposit = Number(d.deposit ?? 0)
      const bookingPayments = paymentsByBooking.get(b.id) ?? []
      const paid = bookingPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
      return {
        booking: b,
        event: eventMap.get(eventId) ?? null,
        payments: bookingPayments,
        total,
        deposit,
        paid,
        due: Math.max(0, total - paid),
        depositDue: Math.max(0, deposit - paid),
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

  async function requestRefund(bookingId: string) {
    await supabase.from('bookings').update({ refund_requested_at: new Date().toISOString() }).eq('id', bookingId)
    if (user) await refetch(user.id)
  }

  const active = lines.filter(l => l.booking.status !== 'cancelled')
  const totalOwed = active.reduce((s, l) => s + l.due, 0)
  const totalDepositDue = active.reduce((s, l) => s + l.depositDue, 0)
  const totalPaid = active.reduce((s, l) => s + l.paid, 0)
  const currency = lines.find(l => l.event)?.event?.currency ?? 'TWD'

  if (loading) {
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Payments</h1>

      <div className="grid grid-cols-3 gap-2">
        <Summary label="Deposits due" value={totalDepositDue} currency={currency} accent="text-rose-400" />
        <Summary label="Balance due"  value={totalOwed}       currency={currency} accent="text-amber-400" />
        <Summary label="Total paid"   value={totalPaid}       currency={currency} accent="text-emerald-400" />
      </div>

      <section>
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Per booking</h2>
        {active.length === 0 ? (
          <p className="text-slate-500 text-sm">No active bookings yet. Check the calendar!</p>
        ) : (
          <div className="space-y-2">
            {active.map(l => (
              <LineCard
                key={l.booking.id}
                line={l}
                currency={currency}
                open={expanded === l.booking.id}
                onToggle={() => setExpanded(expanded === l.booking.id ? null : l.booking.id)}
                onRefund={requestRefund}
              />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-slate-500 text-center">
        Deposit is due up-front to confirm your spot. Balance is settled closer to the event.
      </p>
    </div>
  )
}

function Summary({ label, value, currency, accent }: { label: string; value: number; currency: string; accent: string }) {
  return (
    <div className="bg-slate-800 rounded-xl p-3 text-center">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${accent}`}>{currency} {value.toLocaleString()}</p>
    </div>
  )
}

function LineCard({
  line, currency, open, onToggle, onRefund,
}: {
  line: BookingLine
  currency: string
  open: boolean
  onToggle: () => void
  onRefund: (id: string) => void
}) {
  const { booking, event, total, deposit, paid, due, depositDue, payments } = line
  const label = event?.title ?? '(event)'
  const refundRequested = !!booking.refund_requested_at
  const canRefundDeposit = paid > 0 && !refundRequested

  return (
    <div className="bg-slate-800 rounded-xl">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-slate-700/50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="font-medium text-slate-100 text-sm">{label}</p>
          {event && (
            <p className="text-xs text-slate-400 mt-0.5">{formatEventSpan(event, { withYear: true })}</p>
          )}
          <p className={`text-xs capitalize mt-0.5 font-medium ${STATUS_STYLES[booking.status]}`}>{booking.status}</p>
          {refundRequested && (
            <p className="text-xs text-amber-300 mt-0.5">🔄 Refund requested</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          {total > 0 ? (
            <>
              <p className="text-sm font-semibold text-slate-100">{currency} {total.toLocaleString()}</p>
              {due > 0
                ? <p className="text-xs text-amber-400">{currency} {due.toLocaleString()} due</p>
                : <p className="text-xs text-emerald-400">Paid in full</p>}
            </>
          ) : <p className="text-xs text-slate-500">—</p>}
          <p className="text-xs text-slate-500 mt-0.5">{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-slate-700 pt-3 space-y-3 text-sm">
          {deposit > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-300">Deposit</span>
              <span className={depositDue > 0 ? 'text-amber-400 font-medium' : 'text-emerald-400 font-medium'}>
                {depositDue > 0
                  ? `${currency} ${depositDue.toLocaleString()} due`
                  : `${currency} ${deposit.toLocaleString()} paid ✓`}
              </span>
            </div>
          )}
          {total > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>Total</span>
              <span>{currency} {total.toLocaleString()}</span>
            </div>
          )}
          {paid > 0 && (
            <div className="flex justify-between text-slate-300">
              <span>Paid</span>
              <span className="text-emerald-400">{currency} {paid.toLocaleString()}</span>
            </div>
          )}

          <div className="text-xs text-slate-500 pt-2 border-t border-slate-700">
            Booked {format(new Date(booking.created_at), 'MMM d, yyyy')}
          </div>

          {payments.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-slate-400 uppercase tracking-wider">Payment history</p>
              {payments.map(p => (
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="text-slate-400">
                    {format(new Date(p.created_at), 'MMM d')}{p.method && ` · ${p.method}`}
                  </span>
                  <span className={`${PAYMENT_STATUS_STYLES[p.status]} capitalize`}>
                    {currency} {p.amount.toLocaleString()} · {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {canRefundDeposit && (
            <button
              onClick={() => onRefund(booking.id)}
              className="w-full bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
            >
              Request deposit refund
            </button>
          )}
        </div>
      )}
    </div>
  )
}
