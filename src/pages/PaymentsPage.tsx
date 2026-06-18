import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsForBookings, formatEventSpan } from '../lib/events'
import { fetchCreditsForUser, openCreditBalance, openCreditForBooking } from '../lib/credits'
import { resolveCharges, type ChargeLine } from '../lib/booking-charges'
import { fetchChargeCatalog } from '../lib/booking-charge-catalog'
import { ChargeBreakdown } from '../components/ChargeBreakdown'
import type { AppEvent, Booking, BookingDetails, Payment } from '../types/database'
import {
  CARD, BTN_GHOST, TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, PAGE_BODY,
} from '../styles/tokens'

interface BookingLine {
  booking: Booking
  event: AppEvent | null
  payments: Payment[]
  charges: ChargeLine[]
  total: number
  deposit: number
  paid: number
  /** Open credit awarded for this event — offsets what's owed. */
  credit: number
  due: number
  depositDue: number
}

const PAYMENT_STATUS_STYLES: Record<Payment['status'], string> = {
  pending: 'text-red-600',
  paid: 'text-blue-900 font-semibold',
  refunded: 'text-blue-950 font-medium',
  voided: 'text-blue-950 font-medium line-through',
}

const STATUS_STYLES: Record<Booking['status'], string> = {
  pending: 'text-red-600',
  confirmed: 'text-blue-900 font-semibold',
  cancelled: 'text-blue-900/40 line-through',
  waitlisted: 'text-sky-600',
}

export function PaymentsPage() {
  const { user } = useAuth()
  const [lines, setLines] = useState<BookingLine[]>([])
  const [openCredit, setOpenCredit] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function refetch(uid: string) {
    const [bookingsRes, paymentsRes, credits] = await Promise.all([
      supabase.from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      fetchCreditsForUser(uid),
    ])
    setOpenCredit(openCreditBalance(credits))
    const bookings = bookingsRes.data ?? []
    const payRows = (paymentsRes.data ?? []) as Payment[]

    const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
    const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
    const [eventMap, catalog] = await Promise.all([
      (diveIds.length || courseIds.length)
        ? fetchEventsForBookings(diveIds, courseIds)
        : Promise.resolve(new Map<string, AppEvent>()),
      fetchChargeCatalog(bookings.map(b => b.details as BookingDetails)),
    ])

    const paymentsByBooking = new Map<string, Payment[]>()
    for (const p of payRows) {
      if (!p.booking_id) continue
      const arr = paymentsByBooking.get(p.booking_id) ?? []
      arr.push(p)
      paymentsByBooking.set(p.booking_id, arr)
    }

    setLines(bookings.map(b => {
      const eventId = b.eo_dive_id ?? b.eo_course_id ?? ''
      const event = eventMap.get(eventId) ?? null
      const d = (b.details ?? {}) as { total?: number; deposit?: number }
      const total = Number(d.total ?? 0)
      const deposit = Number(d.deposit ?? 0)
      const bookingPayments = paymentsByBooking.get(b.id) ?? []
      const paid = bookingPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
      const credit = openCreditForBooking(credits, b.id)
      return {
        booking: b,
        event,
        payments: bookingPayments,
        charges: resolveCharges({ details: b.details as BookingDetails, event, ...catalog }),
        total,
        deposit,
        paid,
        credit,
        due: Math.max(0, total - paid - credit),
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
    return <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-white">Payments</h1>

      {openCredit > 0 && (
        <div className="bg-emerald-50 border border-emerald-400 rounded-lg p-3 space-y-1">
          <p className="text-sm font-semibold text-emerald-900">
            Account credit: {currency} {openCredit.toLocaleString()}
          </p>
          <p className="text-xs text-emerald-900">
            We owe you this much — usually from a cancelled event. Mention
            it when you sign up for your next trip and we'll apply it to
            the balance.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Summary label="Deposits due" value={totalDepositDue} currency={currency} accent="text-red-600" />
        <Summary label="Balance due"  value={totalOwed}       currency={currency} accent="text-red-600" />
        <Summary label="Total paid"   value={totalPaid}       currency={currency} accent="text-blue-900" />
      </div>

      <section>
        <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>Per booking</h2>
        {active.length === 0 ? (
          <p className={`${PAGE_BODY} text-sm`}>No active bookings yet. Check the calendar!</p>
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

      <p className={`text-xs ${TEXT_SUBTLE} text-center`}>
        Deposit is due up-front to confirm your spot. Balance is settled closer to the event.
      </p>
    </div>
  )
}

function Summary({ label, value, currency, accent }: { label: string; value: number; currency: string; accent: string }) {
  return (
    <div className={`${CARD} p-3 text-center`}>
      <p className={`text-xs ${TEXT_MUTED} uppercase tracking-wider mb-1`}>{label}</p>
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
  const { booking, event, charges, total, deposit, paid, credit, depositDue, payments } = line
  const label = event?.title ?? '(event)'
  const refundRequested = !!booking.refund_requested_at
  const canRefundDeposit = paid > 0 && !refundRequested
  // Balance nets open credit-for-this-event against what's owed. Positive =
  // still owed (red); negative = net in credit (green).
  const balance = total - paid - credit

  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-sky-50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${TEXT_HEADING} text-sm`}>{label}</p>
          {event && (
            <p className={`text-xs ${TEXT_MUTED} mt-0.5`}>{formatEventSpan(event, { withYear: true })}</p>
          )}
          <p className={`text-xs capitalize mt-0.5 font-medium ${STATUS_STYLES[booking.status]}`}>{booking.status}</p>
          {refundRequested && (
            <p className={`text-xs ${TEXT_ERROR} mt-0.5`}>🔄 Refund requested</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          {total > 0 ? (
            <>
              <p className={`text-sm font-semibold ${TEXT_HEADING}`}>{currency} {total.toLocaleString()}</p>
              {balance > 0
                ? <p className={`text-xs ${TEXT_ERROR}`}>{currency} {balance.toLocaleString()} due</p>
                : balance < 0
                  ? <p className="text-xs text-emerald-700 font-semibold">{currency} {(-balance).toLocaleString()} credit</p>
                  : <p className="text-xs text-blue-900 font-semibold">Paid in full</p>}
            </>
          ) : <p className={`text-xs ${TEXT_SUBTLE}`}>—</p>}
          <p className={`text-xs ${TEXT_SUBTLE} mt-0.5`}>{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-sky-200 pt-3 space-y-3 text-sm">
          {charges.length > 0
            ? <ChargeBreakdown lines={charges} currency={currency} total={total} />
            : total > 0 && (
                <div className={`flex justify-between ${TEXT_BODY}`}>
                  <span>Total</span>
                  <span>{currency} {total.toLocaleString()}</span>
                </div>
              )}
          {deposit > 0 && (
            <div className="flex justify-between">
              <span className={TEXT_BODY}>Deposit</span>
              <span className={depositDue > 0 ? `${TEXT_ERROR} font-medium` : 'text-blue-900 font-semibold'}>
                {depositDue > 0
                  ? `${currency} ${depositDue.toLocaleString()} due`
                  : `${currency} ${deposit.toLocaleString()} paid ✓`}
              </span>
            </div>
          )}
          {paid > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>Paid</span>
              <span className="text-blue-900 font-semibold">{currency} {paid.toLocaleString()}</span>
            </div>
          )}
          {credit > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>Credit (this event)</span>
              <span className="text-emerald-700 font-semibold">{currency} {credit.toLocaleString()}</span>
            </div>
          )}
          {total > 0 && (
            <div className={`flex justify-between font-semibold pt-1 border-t border-sky-200 ${TEXT_BODY}`}>
              <span>Balance</span>
              {balance > 0 ? (
                <span className={TEXT_ERROR}>{currency} {balance.toLocaleString()} due</span>
              ) : balance < 0 ? (
                <span className="text-emerald-700">{currency} {(-balance).toLocaleString()} credit</span>
              ) : (
                <span className="text-blue-900">Settled ✓</span>
              )}
            </div>
          )}

          <div className={`text-xs ${TEXT_SUBTLE} pt-2 border-t border-sky-200`}>
            Booked {format(new Date(booking.created_at), 'MMM d, yyyy')}
          </div>

          {payments.length > 0 && (
            <div className="space-y-1">
              <p className={`text-xs ${TEXT_MUTED} uppercase tracking-wider`}>Payment history</p>
              {payments.map(p => (
                <div key={p.id} className="flex justify-between text-xs">
                  <span className={TEXT_MUTED}>
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
            <button onClick={() => onRefund(booking.id)} className={`w-full ${BTN_GHOST} text-xs py-2`}>
              Request deposit refund
            </button>
          )}
        </div>
      )}
    </div>
  )
}
