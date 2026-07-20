import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { personName } from '../../lib/names'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { useToast } from '../../hooks/useToast'
import { fetchEventsForBookings } from '../../lib/events'
import { notifyRefundApproved, rejectRefundRequest } from '../../lib/refunds'
import { Spinner } from '../../components/ui/Spinner'
import { CARD_ELEVATED, BTN_PRIMARY, BTN_GHOST, TEXT_MUTED } from '../../styles/tokens'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import type { Booking } from '../../types/database'

const rf = t.admin.refunds

// Cross-event queue of open refund requests. A diver requesting a refund only
// stamps `bookings.refund_requested_at`; before this page the sole admin
// surface was a banner buried in one registrant's card on the event detail
// page, so requests were easy to miss. "Open" == request stamped and the
// booking not yet cancelled (approving a refund cancels the booking, which is
// what drops it off this list). Money movement itself is off-app.

interface RefundRow {
  bookingId: string
  diverName: string
  eventTitle: string
  paid: number
  currency: string
  requestedAt: string
}

async function loadRefundRequests(): Promise<RefundRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*')
    .not('refund_requested_at', 'is', null)
    .neq('status', 'cancelled')
    .order('refund_requested_at', { ascending: true })
  if (error) throw error
  const bookings = (data ?? []) as Booking[]
  if (!bookings.length) return []

  const userIds = [...new Set(bookings.map(b => b.user_id).filter((x): x is string => !!x))]
  const bookingIds = bookings.map(b => b.id)
  const eventIds = [...new Set(bookings.map(b => b.event_id).filter((x): x is string => !!x))]

  const [profilesRes, paymentsRes, eventMap] = await Promise.all([
    supabase.from('profiles').select('id, name, nickname').in('id', userIds),
    supabase.from('payments').select('booking_id, amount, status').in('booking_id', bookingIds),
    fetchEventsForBookings(eventIds),
  ])
  if (profilesRes.error) throw profilesRes.error
  if (paymentsRes.error) throw paymentsRes.error

  const nameById = new Map(
    (profilesRes.data ?? []).map(p => [p.id, personName(p.name, p.nickname)]),
  )
  // Net paid, matching the accounting export: paid positive, refunded
  // negative, voided excluded.
  const paidByBooking = new Map<string, number>()
  for (const p of paymentsRes.data ?? []) {
    if (!p.booking_id || p.status === 'voided') continue
    const signed = p.status === 'refunded' ? -p.amount : p.amount
    paidByBooking.set(p.booking_id, (paidByBooking.get(p.booking_id) ?? 0) + signed)
  }

  return bookings.map(b => {
    const event = b.event_id ? eventMap.get(b.event_id) ?? null : null
    return {
      bookingId: b.id,
      diverName: nameById.get(b.user_id ?? '') || rf.colDiver,
      eventTitle: event?.title ?? rf.eventFallback,
      paid: paidByBooking.get(b.id) ?? 0,
      currency: event?.currency ?? siteConfig.locale.currency,
      requestedAt: b.refund_requested_at as string,
    }
  })
}

export function AdminRefundsPage() {
  const toast = useToast()
  const [rows, setRows] = useState<RefundRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadRefundRequests()
      .then(r => { if (alive) setRows(r) })
      .catch(e => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  async function approve(bookingId: string) {
    setActing(bookingId)
    try {
      // Approval just cancels the booking — the actual refund (bank transfer
      // etc.) happens off-app. Mirrors AdminEventDetailPage.approveRefund.
      const { error: err } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
      if (err) throw err
      // Fire-and-forget: notify the diver, but never let a push failure turn a
      // successful approval into an error toast.
      void notifyRefundApproved(bookingId).catch(() => {})
      setRows(prev => (prev ?? []).filter(r => r.bookingId !== bookingId))
      toast.success(rf.approved)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setActing(null)
    }
  }

  async function reject(bookingId: string) {
    setActing(bookingId)
    try {
      // Clears the request and leaves the booking untouched, so a diver who
      // asked by accident is back where they started and can ask again.
      await rejectRefundRequest(bookingId)
      setRows(prev => (prev ?? []).filter(r => r.bookingId !== bookingId))
      toast.success(rf.rejected)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setActing(null)
    }
  }

  if (error) {
    return <div className="max-w-3xl mx-auto"><p className="text-sm text-red-200 bg-red-900/40 border border-accent rounded-lg p-3">{error}</p></div>
  }
  if (!rows) {
    return (
      <div className="max-w-3xl mx-auto flex justify-center py-16">
        <Spinner className="w-6 h-6 border-2 border-surface-300" />
      </div>
    )
  }

  const money = (n: number, cur: string) => `${cur} ${Math.round(n).toLocaleString()}`

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">{rf.title}</h1>
          <p className={`text-sm ${TEXT_MUTED}`}>{rf.subtitle}</p>
        </div>
        <Link to="/admin/dashboard" className="text-sm text-amber-300 hover:text-amber-200 shrink-0 mt-1">
          {t.admin.history.dashboardLink}
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className={`${CARD_ELEVATED} p-6 text-center`}>
          <p className={TEXT_MUTED}>{rf.empty}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map(r => (
            <li key={r.bookingId} className={`${CARD_ELEVATED} p-4 flex items-center justify-between gap-3`}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-brand-950 truncate">{r.diverName}</div>
                <div className={`text-xs ${TEXT_MUTED} truncate`}>{r.eventTitle}</div>
                <div className={`text-xs ${TEXT_MUTED} mt-0.5`}>
                  {rf.colPaid}: <span className="tabular-nums text-brand-900 font-medium">{money(r.paid, r.currency)}</span>
                  {' · '}
                  {rf.colRequested}: {format(new Date(r.requestedAt), 'PP p')}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => approve(r.bookingId)}
                  disabled={acting === r.bookingId}
                  className={`${BTN_PRIMARY} whitespace-nowrap`}
                >
                  {rf.approve}
                </button>
                <button
                  type="button"
                  onClick={() => reject(r.bookingId)}
                  disabled={acting === r.bookingId}
                  className={`${BTN_GHOST} whitespace-nowrap`}
                >
                  {rf.reject}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
