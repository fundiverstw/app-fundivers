import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { shopZoned } from '../../lib/dates'
import { personName } from '../../lib/names'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errors'
import { useToast } from '../../hooks/useToast'
import { fetchEventsForBookings } from '../../lib/events'
import { notifyRefundApproved, rejectRefundRequest } from '../../lib/refunds'
import {
  fetchUnreconciledCancellations, recordCancellationRefund, convertCancellationToCredit,
  settleCancellationAsKept, type UnreconciledCancellation,
} from '../../lib/unreconciled-cancellations'
import { useAuth } from '../../hooks/useAuth'
import { fetchActorNames, actorLabel, type ActorNames } from '../../lib/actor-names'
import { Spinner } from '../../components/ui/Spinner'
import { CARD_ELEVATED, BTN_PRIMARY, BTN_GHOST, BTN_XS_PRIMARY, BTN_XS_GHOST, TEXT_MUTED } from '../../styles/tokens'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'
import type { Booking } from '../../types/database'

const rf = t.admin.refunds

// Two queues, both about money the shop still has to act on.
//
// 1. Open refund REQUESTS. A diver requesting a refund only stamps
//    `bookings.refund_requested_at`; before this page the sole admin surface
//    was a banner buried in one registrant's card on the event detail page, so
//    requests were easy to miss. "Open" == request stamped and the booking not
//    yet cancelled (approving a refund cancels the booking, which is what drops
//    it off this list). Money movement itself is off-app.
//
// 2. Cancelled bookings that STILL HOLD MONEY. Approving a refund — like every
//    other booking cancellation — only cancels the booking; the cash moved
//    off-app and nothing records that it came back. Every other surface then
//    goes quiet: a cancelled booking reads "settled", and it drops out of the
//    diver's account credit. This second list is the only place that money is
//    visible, and it clears when an admin picks one of the three endings:
//    refunded, kept as credit, or kept as a cancellation fee. See
//    src/lib/unreconciled-cancellations.ts.

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
  const eventIds = [...new Set(bookings.map(b => b.event_id))]

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
    const event = eventMap.get(b.event_id) ?? null
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

const HOLDING_LABELS = { eventFallback: rf.eventFallback, diverFallback: rf.colDiver }

const money = (n: number, cur: string) => `${cur} ${Math.round(n).toLocaleString()}`

export function AdminRefundsPage() {
  const toast = useToast()
  const { profile } = useAuth()
  const [rows, setRows] = useState<RefundRow[] | null>(null)
  const [holding, setHolding] = useState<UnreconciledCancellation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [actorNames, setActorNames] = useState<ActorNames>(new Map())

  useEffect(() => {
    let alive = true
    Promise.all([loadRefundRequests(), fetchUnreconciledCancellations(HOLDING_LABELS)])
      .then(([requests, unreconciled]) => {
        if (!alive) return
        setRows(requests)
        setHolding(unreconciled)
        void fetchActorNames(unreconciled.map(r => r.cancelledBy))
          .then(names => { if (alive) setActorNames(names) })
          .catch(() => {})
      })
      .catch(e => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  // Approving a refund cancels the booking, which moves it straight from the
  // requests queue into the holding list — the money is still with the shop
  // until someone records that it went back.
  async function refreshHolding() {
    try {
      const next = await fetchUnreconciledCancellations(HOLDING_LABELS)
      setHolding(next)
      setActorNames(await fetchActorNames(next.map(r => r.cancelledBy)))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  // The one ending that moves money, so it is the one that has to name the
  // transfer. Prompted rather than typed inline because this list is a queue of
  // one-tap decisions -- a permanent input on every row would read as something
  // to fill in before deciding, which it is not.
  async function markRefunded(row: UnreconciledCancellation) {
    if (!profile?.id) return
    const reference = window.prompt(rf.refundReferencePrompt(money(row.amount, row.currency)), '')
    if (reference === null) return
    if (!reference.trim()) { toast.error(rf.referenceRequired); return }
    setActing(row.bookingId)
    try {
      await recordCancellationRefund({
        row, recordedBy: profile.id, note: rf.refundNote, reference: reference.trim(),
      })
      setHolding(prev => (prev ?? []).filter(r => r.bookingId !== row.bookingId))
      toast.success(rf.markRefundedDone)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setActing(null)
    }
  }

  // The shop keeps the money. Records no movement — the cash is already on the
  // booking as revenue — only that someone decided it, which is what lets the
  // row leave the list. The diver is shown the kept amount on their own
  // booking, so this is an acknowledgement, not a quiet write-off.
  async function keepAsFee(row: UnreconciledCancellation) {
    if (!profile?.id) return
    setActing(row.bookingId)
    try {
      await settleCancellationAsKept({
        row,
        settledBy: profile.id,
        note: rf.feeNote(money(row.amount, row.currency)),
      })
      setHolding(prev => (prev ?? []).filter(r => r.bookingId !== row.bookingId))
      toast.success(rf.keepAsFeeDone)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setActing(null)
    }
  }

  async function keepAsCredit(row: UnreconciledCancellation) {
    if (!profile?.id) return
    setActing(row.bookingId)
    try {
      await convertCancellationToCredit({
        row, createdBy: profile.id, reason: rf.creditReason(row.eventTitle),
      })
      setHolding(prev => (prev ?? []).filter(r => r.bookingId !== row.bookingId))
      toast.success(rf.toCreditDone)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setActing(null)
    }
  }

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
      void refreshHolding()
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
  if (!rows || !holding) {
    return (
      <div className="max-w-3xl mx-auto flex justify-center py-16">
        <Spinner className="w-6 h-6 border-2 border-surface-300" />
      </div>
    )
  }

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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{rf.requestsHeading}</h2>
        <p className={`text-xs ${TEXT_MUTED}`}>{rf.requestsBlurb}</p>
      </section>

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
                  {rf.colRequested}: {format(shopZoned(new Date(r.requestedAt)), 'PP p')}
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

      <section className="space-y-2 pt-2">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{rf.holdingHeading}</h2>
        <p className={`text-xs ${TEXT_MUTED}`}>{rf.holdingBlurb}</p>
      </section>

      {holding.length === 0 ? (
        <div className={`${CARD_ELEVATED} p-6 text-center`}>
          <p className={TEXT_MUTED}>{rf.holdingEmpty}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {holding.map(r => (
            <li key={r.bookingId} className={`${CARD_ELEVATED} p-4 flex items-center justify-between gap-3`}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-brand-950 truncate">{r.diverName}</div>
                <div className={`text-xs ${TEXT_MUTED} truncate`}>{r.eventTitle}</div>
                <div className={`text-xs ${TEXT_MUTED} mt-0.5`}>
                  {rf.colHolding}: <span className="tabular-nums text-amber-800 font-semibold">{money(r.amount, r.currency)}</span>
                  {r.cancelledAt && (
                    <> · {t.admin.bookingPayments.cancelledOn(format(shopZoned(new Date(r.cancelledAt)), 'PP'))}
                    {' '}{t.admin.actor.by(actorLabel(actorNames, r.cancelledBy, t.admin.actor))}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => markRefunded(r)}
                  disabled={acting === r.bookingId}
                  className={`${BTN_XS_GHOST} whitespace-nowrap`}
                >
                  {rf.markRefunded}
                </button>
                <button
                  type="button"
                  onClick={() => keepAsFee(r)}
                  disabled={acting === r.bookingId}
                  className={`${BTN_XS_GHOST} whitespace-nowrap`}
                >
                  {rf.keepAsFee}
                </button>
                <button
                  type="button"
                  onClick={() => keepAsCredit(r)}
                  disabled={acting === r.bookingId}
                  className={`${BTN_XS_PRIMARY} whitespace-nowrap`}
                >
                  {rf.toCredit}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
