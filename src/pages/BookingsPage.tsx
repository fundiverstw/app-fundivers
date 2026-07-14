import { useEffect, useState } from 'react'
import { siteConfig } from '../config/site'
import { STATUS_STYLES } from '../lib/booking-status'
import { PageLoading } from '../components/ui/Spinner'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { fetchEventsForBookings, formatEventSpan } from '../lib/events'
import { fetchAmendmentsForBookings, amendmentsDelta } from '../lib/booking-amendments'
import { uniqueUuids } from '../lib/uuid'
import { resolveCharges, type ChargeLine } from '../lib/booking-charges'
import { fetchChargeCatalog } from '../lib/booking-charge-catalog'
import { fetchCreditsForUser, openCreditForBooking } from '../lib/credits'
import { bookingBalance } from '../lib/booking-balance'
import { netPaid } from '../lib/payments'
import { ShareEventButton } from '../components/ShareEventButton'
import { ChargeBreakdown } from '../components/ChargeBreakdown'
import type { AppEvent, Booking, BookingAmendment, BookingDetails, Payment, WaitlistOffer } from '../types/database'
import {
  CARD, BTN_GHOST, BTN_DANGER, TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, PAGE_BODY,
} from '../styles/tokens'
import { t } from '../i18n'

type Row = Booking & {
  event: AppEvent | null
  payments: Payment[]
  paidSum: number
  charges: ChargeLine[]
  /** Open credit awarded for this event — offsets what's owed. */
  credit: number
  amendments: BookingAmendment[]
  /** Live (status='pending', not expired) waitlist offer on this booking,
   *  if any. Drives the "Spot opened — Accept this spot" banner. */
  offer: WaitlistOffer | null
  /** Snapshot label like "23h 14m left", computed at fetch time so the
   *  banner doesn't have to call Date.now() during render. Refreshed
   *  on every refetch — the staleness is visible to anyone who reloads. */
  offerRemainingLabel: string | null
}

function formatRemaining(expiresAt: string, nowMs: number): string {
  const ms = new Date(expiresAt).getTime() - nowMs
  if (ms <= 0) return t.bookings.expiringNow
  const hours = Math.floor(ms / 3_600_000)
  const mins  = Math.floor((ms % 3_600_000) / 60_000)
  if (hours > 0) return t.bookings.hoursMinsLeft(hours, mins)
  if (mins  > 0) return t.bookings.minsLeft(mins)
  return t.bookings.expiringNow
}

type AddonNameMap = Map<string, string>


export function BookingsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [addonNames, setAddonNames] = useState<AddonNameMap>(new Map())
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null)

  async function refetch(uid: string) {
    const [bookingsRes, paymentsRes, credits] = await Promise.all([
      supabase.from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending: false }),
      supabase.from('payments').select('*').eq('user_id', uid),
      fetchCreditsForUser(uid),
    ])
    const bookings = bookingsRes.data ?? []
    const payments = (paymentsRes.data ?? []) as Payment[]

    // Live waitlist offers (status='pending', not expired). RLS scopes to
    // the diver's own offers. We do this in the same refetch so the
    // "Accept this spot" banner appears as soon as the page loads — no
    // separate request, no flicker.
    const waitlistedIds = bookings.filter(b => b.status === 'waitlisted').map(b => b.id)
    let offersByBooking = new Map<string, WaitlistOffer>()
    if (waitlistedIds.length) {
      const { data: offers } = await supabase
        .from('waitlist_offers')
        .select('*')
        .in('booking_id', waitlistedIds)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
      offersByBooking = new Map((offers ?? []).map(o => [o.booking_id, o as WaitlistOffer]))
    }

    const eventIds = bookings.map(b => b.event_id).filter((x): x is string => !!x)
    const [eventMap, catalog] = await Promise.all([
      eventIds.length
        ? fetchEventsForBookings(eventIds)
        : Promise.resolve(new Map<string, AppEvent>()),
      fetchChargeCatalog(bookings.map(b => b.details as BookingDetails)),
    ])

    const paymentsByBooking = new Map<string, Payment[]>()
    for (const p of payments) {
      if (!p.booking_id) continue
      const arr = paymentsByBooking.get(p.booking_id) ?? []
      arr.push(p)
      paymentsByBooking.set(p.booking_id, arr)
    }

    const amendmentsByBooking = await fetchAmendmentsForBookings(bookings.map(b => b.id))

    const nowMs = Date.now()
    setRows(bookings.map(b => {
      const bookingPayments = paymentsByBooking.get(b.id) ?? []
      const paidSum = netPaid(bookingPayments)
      const offer = offersByBooking.get(b.id) ?? null
      const event = b.event_id ? eventMap.get(b.event_id) ?? null : null
      return {
        ...b,
        event,
        payments: bookingPayments,
        paidSum,
        charges: resolveCharges({ details: b.details as BookingDetails, event, ...catalog }),
        credit: openCreditForBooking(credits, b.id),
        amendments: amendmentsByBooking.get(b.id) ?? [],
        offer,
        offerRemainingLabel: offer ? formatRemaining(offer.expires_at, nowMs) : null,
      }
    }))

    // Resolve add-on IDs → display names so the breakdown doesn't show UUIDs.
    const addonIds = uniqueUuids(bookings.flatMap(b => (b.details as Booking['details'])?.add_ons ?? []))
    if (addonIds.length) {
      const { data } = await supabase
        .from('addons')
        .select('id, display_title, admin_title')
        .in('id', addonIds)
      setAddonNames(new Map((data ?? []).map(a => [a.id, a.display_title || a.admin_title || a.id])))
    } else {
      setAddonNames(new Map())
    }

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

  async function acceptWaitlistOffer(offerId: string) {
    setAcceptingOfferId(offerId)
    try {
      // accept_waitlist_offer is a SECURITY DEFINER RPC — flips
      // waitlist_offers.status -> 'accepted' and bookings.status ->
      // 'pending' atomically. The function raises if the offer is
      // already accepted/expired or not owned by the caller.
      const { error } = await supabase.rpc('accept_waitlist_offer', { p_offer_id: offerId })
      if (error) throw error
      toast.success(t.bookings.spotAccepted)
      if (user) await refetch(user.id)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAcceptingOfferId(null)
    }
  }

  const upcoming = rows.filter(r =>
    r.status !== 'cancelled' && r.event && new Date(r.event.start_time) >= new Date()
  )
  const past = rows.filter(r =>
    r.status === 'cancelled' || !r.event || new Date(r.event.start_time) < new Date()
  )

  if (loading) {
    return <PageLoading />
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-white">{t.bookings.title}</h1>

      <section>
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-2">{t.bookings.upcoming}</h2>
        {upcoming.length === 0
          ? <p className={`${PAGE_BODY} text-sm`}>{t.bookings.noUpcoming}</p>
          : <div className="space-y-2">
              {upcoming.map(r => (
                <Card
                  key={r.id}
                  row={r}
                  addonNames={addonNames}
                  open={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                  onCancel={cancelBooking}
                  onRefund={requestRefund}
                  onAcceptOffer={acceptWaitlistOffer}
                  acceptingOfferId={acceptingOfferId}
                />
              ))}
            </div>
        }
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider mb-2">{t.bookings.pastCancelled}</h2>
          <div className="space-y-2">
            {past.map(r => (
              <Card
                key={r.id}
                row={r}
                addonNames={addonNames}
                open={expanded === r.id}
                onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                onCancel={cancelBooking}
                onRefund={requestRefund}
                onAcceptOffer={acceptWaitlistOffer}
                acceptingOfferId={acceptingOfferId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Card({
  row, addonNames, open, onToggle, onCancel, onRefund, onAcceptOffer, acceptingOfferId,
}: {
  row: Row
  addonNames: AddonNameMap
  open: boolean
  onToggle: () => void
  onCancel: (id: string) => void
  onRefund: (id: string) => void
  onAcceptOffer: (offerId: string) => void
  acceptingOfferId: string | null
}) {
  const details = (row.details ?? {}) as Booking['details']
  const total = Number((details as { total?: number } | undefined)?.total ?? 0)
  const deposit = Number((details as { deposit?: number } | undefined)?.deposit ?? 0)
  const canCancel = row.status === 'pending' && row.paidSum === 0 && !row.refund_requested_at
  const canRefund = row.paidSum > 0 && row.status !== 'cancelled' && !row.refund_requested_at
  const currency = row.event?.currency ?? siteConfig.locale.currency
  const amendmentLines = row.amendments.map(a => ({ label: a.note, amount: a.amount }))
  const owed = total + amendmentsDelta(row.amendments)
  // Balance nets open credit-for-this-event against what's owed (incl.
  // amendments). A negative balance — whether from an awarded credit or an
  // overpayment — is money the shop owes the diver, shown as a credit.
  const bal = bookingBalance(owed, row.paidSum, row.credit, { cancelled: row.status === 'cancelled' })

  return (
    <div className={CARD}>
      {row.offer && <WaitlistOfferBanner
        remainingLabel={row.offerRemainingLabel ?? ''}
        onAccept={() => onAcceptOffer(row.offer!.id)}
        accepting={acceptingOfferId === row.offer.id}
      />}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-surface-50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${TEXT_HEADING} text-sm`}>
            {row.event?.title ?? t.bookings.eventUnavailable}
          </p>
          {row.event && (
            <p className={`text-xs ${TEXT_MUTED} mt-0.5`}>
              {formatEventSpan(row.event, { withYear: true })}
              {' · '}
              {row.event.type === 'dive' ? t.calendar.typeDive : t.calendar.typeCourse}
            </p>
          )}
          {row.refund_requested_at && (
            <p className={`text-xs ${TEXT_ERROR} mt-0.5`}>🔄 {t.bookings.refundRequested} {format(new Date(row.refund_requested_at), 'MMM d')}</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          <span className={`text-xs font-medium capitalize ${STATUS_STYLES[row.status]}`}>{row.status}</span>
          <p className={`text-xs ${TEXT_SUBTLE} mt-0.5`}>{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-surface-200 pt-3 space-y-3 text-sm">
          {(row.charges.length > 0 || amendmentLines.length > 0)
            ? <ChargeBreakdown lines={row.charges} amendments={amendmentLines} currency={currency} total={owed} />
            : total > 0 && (
                <div className={`flex justify-between ${TEXT_BODY}`}>
                  <span>{t.bookings.total}</span>
                  <span className="font-semibold">{currency} {total.toLocaleString()}</span>
                </div>
              )}
          {deposit > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>{t.bookings.deposit}</span>
              <span className={row.paidSum >= deposit ? 'text-brand-900 font-semibold' : TEXT_ERROR}>
                {currency} {deposit.toLocaleString()} {row.paidSum >= deposit ? '✓' : t.bookings.due}
              </span>
            </div>
          )}

          {row.paidSum > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>{t.bookings.paidSoFar}</span>
              <span className="text-brand-900 font-semibold">{currency} {row.paidSum.toLocaleString()}</span>
            </div>
          )}
          {row.credit > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>{t.bookings.creditThisEvent}</span>
              <span className="text-emerald-700 font-semibold">{currency} {row.credit.toLocaleString()}</span>
            </div>
          )}
          {total > 0 && (
            <div className={`flex justify-between font-semibold pt-1 border-t border-surface-200 ${TEXT_BODY}`}>
              <span>{t.bookings.balance}</span>
              {bal.state === 'due' && <span className={TEXT_ERROR}>{currency} {bal.amount.toLocaleString()} {t.bookings.due}</span>}
              {bal.state === 'credit' && <span className="text-emerald-700">{currency} {bal.amount.toLocaleString()} {t.bookings.creditWord}</span>}
              {bal.state === 'settled' && <span className="text-brand-900">{t.bookings.settled}</span>}
            </div>
          )}

          <Breakdown details={details} addonNames={addonNames} />

          {row.notes && (
            <p className={`text-xs ${TEXT_MUTED} bg-surface-50 rounded p-2`}>📝 {row.notes}</p>
          )}
          <p className={`text-xs ${TEXT_SUBTLE}`}>
            {t.bookings.bookedLabel} {format(new Date(row.created_at), 'MMM d, yyyy')}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {canCancel && (
              <button onClick={() => onCancel(row.id)} className={`flex-1 ${BTN_DANGER} text-xs py-2 px-3`}>
                {t.calendar.cancelBooking}
              </button>
            )}
            {canRefund && (
              <button onClick={() => onRefund(row.id)} className={`flex-1 ${BTN_GHOST} text-xs py-2 px-3`}>
                {t.bookings.requestRefund}
              </button>
            )}
            {row.event && (
              <ShareEventButton
                eventId={row.event.id}
                className="flex-1 text-xs py-2 px-3 rounded-lg bg-surface-700 hover:bg-surface-800 text-white font-medium"
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function WaitlistOfferBanner({
  remainingLabel, onAccept, accepting,
}: {
  remainingLabel: string
  onAccept: () => void
  accepting: boolean
}) {
  return (
    <div className="bg-accent text-white px-4 py-3 rounded-t-xl flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-sm">{t.bookings.offerTitle}</p>
        <p className="text-xs text-white/90">{t.bookings.offerDetail(remainingLabel)}</p>
      </div>
      <button
        type="button"
        onClick={onAccept}
        disabled={accepting}
        className="bg-red-50 text-red-700 font-semibold text-xs rounded-lg px-3 py-1.5 hover:bg-red-100 transition-colors disabled:opacity-50 shrink-0"
      >
        {accepting ? t.bookings.accepting : t.bookings.accept}
      </button>
    </div>
  )
}

function Breakdown({ details, addonNames }: { details: Booking['details'] | undefined; addonNames: AddonNameMap }) {
  const d = details ?? {}
  const items: Array<[string, string | null]> = []
  if (d.gear?.assistance_note) {
    items.push([t.bookings.breakdown.gearNeedsHelp, d.gear.assistance_note])
  } else if (d.gear?.rent) {
    const extras = d.gear.items?.length ? d.gear.items.join(', ') : null
    items.push([t.bookings.breakdown.gear, extras])
  }
  if (d.room?.option_id) items.push([t.bookings.breakdown.room, d.room.notes ?? null])
  if ((d.add_ons?.length ?? 0) > 0) {
    const labels = d.add_ons!.map(id => addonNames.get(id) ?? id)
    items.push([t.bookings.breakdown.addons, labels.join(', ')])
  }
  if (d.transportation) items.push([t.bookings.breakdown.transportation, null])
  if (d.nitrox_course_addon) items.push([t.bookings.breakdown.nitroxAddon, null])
  if (d.payment_method) items.push([t.bookings.breakdown.payment, d.payment_method.replace('_', ' ')])

  if (items.length === 0) return null
  return (
    <div className={`text-xs ${TEXT_MUTED} space-y-0.5`}>
      {items.map(([label, extra]) => (
        <p key={label}>{label}{extra && <span className={TEXT_SUBTLE}> — {extra}</span>}</p>
      ))}
    </div>
  )
}
