import { useEffect, useState } from 'react'
import { siteConfig } from '../config/site'
import { STATUS_STYLES } from '../lib/booking-status'
import { PageLoading } from '../components/ui/Spinner'
import { format } from 'date-fns'
import { shopZoned } from '../lib/dates'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { personName } from '../lib/names'
import { fetchEventsForBookings, formatEventSpan } from '../lib/events'
import { fetchCreditsForUser, openCreditForBooking, openCreditBalance, diverCreditBalance, applyCreditToBooking, plannedCreditApplication, cancellationKept, RETURN_SOURCES } from '../lib/credits'
import { useToast } from '../hooks/useToast'
import { bookingBalance, depositDue } from '../lib/booking-balance'
import { netPaid } from '../lib/payments'
import { resolveCharges, type ChargeLine } from '../lib/booking-charges'
import { fetchChargeCatalog } from '../lib/booking-charge-catalog'
import { fetchAmendmentsForBookings, amendmentsDelta } from '../lib/booking-amendments'
import { fetchBookingDiscounts, fetchDiscounts } from '../lib/discounts'
import { ChargeBreakdown, type AmendmentLine } from '../components/ChargeBreakdown'
import type { AppEvent, Booking, BookingDetails, BookingDiscount, Credit, Discount, Payment } from '../types/database'
import {
  CARD, BTN_GHOST, BTN_PRIMARY, TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, PAGE_BODY,
} from '../styles/tokens'
import { t } from '../i18n'

interface BookingLine {
  booking: Booking
  event: AppEvent | null
  payments: Payment[]
  charges: ChargeLine[]
  amendments: AmendmentLine[]
  /** Discounts asked for on this booking. A pending one has changed no figure
   *  on this card -- it is shown so the diver knows the shop has it, and does
   *  not read the undiscounted balance as the shop ignoring their request. */
  discounts: Array<{ id: string; label: string; status: BookingDiscount['status']; amount: number | null }>
  total: number
  /** total + amendments — what the diver actually owes before payments. */
  owed: number
  deposit: number
  paid: number
  /** Open credit awarded for this event — offsets what's owed. */
  credit: number
  /** What the shop kept off a cancelled booking: net paid less anything
   *  returned as a cancellation credit. Zero unless a person or a
   *  non-refundable-deposit policy settled it. **Null when this viewer
   *  cannot read the booking's credits** — a lead booker who is not the
   *  owner's parent sees no credit rows at all, and treating that silence
   *  as "nothing came back" would report the whole payment as kept. */
  feeKept: number | null
  due: number
  depositDue: number
  /** Display name of the diver this booking belongs to (for the lead's
   *  group rollup, where siblings belong to different family members). */
  ownerName: string
  /** Display name of the lead booker paying for this booking, when someone
   *  other than the viewer covers it. Null otherwise. */
  coveredByName: string | null
}

/**
 * May this viewer be told what the shop kept off a booking?
 *
 * Only if they can read the booking's return credits, because the figure is
 * net paid MINUS those, and silence would read as "nothing came back" — the
 * whole payment reported as kept. Credits go to whoever the money belonged to:
 * the payer when a lead covered the booking, the owner otherwise
 * (bookings_credit_on_cancel, 20260825000000), and RLS shows a viewer their own
 * rows plus their children's. So the question is whether the viewer is that
 * person, or their parent.
 */
function keptVisibleTo(
  uid: string,
  booking: Pick<Booking, 'user_id' | 'payer_id'>,
  parentOf: Map<string, string | null>,
): boolean {
  const owner = booking.payer_id ?? booking.user_id
  return owner === uid || parentOf.get(owner) === uid
}

const PAYMENT_STATUS_STYLES: Record<Payment['status'], string> = {
  pending: 'text-red-600',
  paid: 'text-brand-900 font-semibold',
  refunded: 'text-brand-950 font-medium',
  voided: 'text-brand-950 font-medium line-through',
}


export function PaymentsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [lines, setLines] = useState<BookingLine[]>([])
  const [openCredit, setOpenCredit] = useState<number>(0)
  /** Open credit not tied to any single booking's offset — the spendable
   *  pool a diver can apply to a balance. Indexed nowhere; we recompute the
   *  per-booking applicable amount from this and openCreditForBooking. */
  const [creditRows, setCreditRows] = useState<Credit[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [applying, setApplying] = useState<string | null>(null)
  const [applyingAll, setApplyingAll] = useState(false)

  async function refetch(uid: string) {
    // Fetch both the diver's own bookings AND any the diver pays for as the
    // lead booker (payer_id = me) — children's bookings included. Payments are
    // pulled by booking_id so the lead sees what's been paid on each sibling.
    const [bookingsRes, credits] = await Promise.all([
      supabase.from('bookings').select('*').or(`user_id.eq.${uid},payer_id.eq.${uid}`).order('created_at', { ascending: false }),
      fetchCreditsForUser(uid),
    ])
    const bookings = bookingsRes.data ?? []
    const bookingIds = bookings.map(b => b.id)
    const personIds = [...new Set(bookings.flatMap(b => [b.user_id, b.payer_id]).filter((x): x is string => !!x))]

    const eventIds = bookings.map(b => b.event_id)
    const [
      paymentsRes, profilesRes, eventMap, catalog, amendmentsByBooking,
      discountsByBooking, discountCatalog,
    ] = await Promise.all([
      bookingIds.length
        ? supabase.from('payments').select('*').in('booking_id', bookingIds)
        : Promise.resolve({ data: [] as Payment[] }),
      // parent_account decides whether this viewer may read a booking owner's
      // credits at all (the "credits: parent select children" policy), which is
      // what separates "nothing was returned" from "I cannot see it".
      supabase.from('profiles').select('id, name, nickname, parent_account').in('id', personIds),
      eventIds.length
        ? fetchEventsForBookings(eventIds)
        : Promise.resolve(new Map<string, AppEvent>()),
      fetchChargeCatalog(bookings.map(b => b.details as BookingDetails)),
      fetchAmendmentsForBookings(bookings.map(b => b.id)),
      fetchBookingDiscounts(bookingIds),
      // Retired discounts included: a booking keeps the one it was granted.
      fetchDiscounts().catch(() => [] as Discount[]),
    ])
    const payRows = (paymentsRes.data ?? []) as Payment[]
    const nameById = new Map<string, string>(
      (profilesRes.data ?? []).map(p => [p.id, personName(p.name, p.nickname) || '(diver)']),
    )
    const parentOf = new Map<string, string | null>(
      (profilesRes.data ?? []).map(p => [p.id, p.parent_account]),
    )

    // Cancellation credits are written against the booking OWNER, not whoever
    // paid, so the viewer's own credit rows say nothing about a booking they
    // merely lead. Fetch by booking instead; RLS narrows it to the owners this
    // viewer is allowed to see.
    const { data: returnedRows } = bookingIds.length
      ? await supabase.from('credits').select('booking_id, amount, source')
          .in('booking_id', bookingIds).in('source', RETURN_SOURCES)
      : { data: [] }
    const returnedCredits = (returnedRows ?? []) as Array<Pick<Credit, 'booking_id' | 'amount' | 'source'>>

    const paymentsByBooking = new Map<string, Payment[]>()
    for (const p of payRows) {
      if (!p.booking_id) continue
      const arr = paymentsByBooking.get(p.booking_id) ?? []
      arr.push(p)
      paymentsByBooking.set(p.booking_id, arr)
    }

    const lineData: BookingLine[] = bookings.map(b => {
      const event = eventMap.get(b.event_id) ?? null
      const d = (b.details ?? {}) as { total?: number; deposit?: number }
      const total = Number(d.total ?? 0)
      const deposit = Number(d.deposit ?? 0)
      const bookingPayments = paymentsByBooking.get(b.id) ?? []
      const paid = netPaid(bookingPayments)
      const credit = openCreditForBooking(credits, b.id)
      const rows = amendmentsByBooking.get(b.id) ?? []
      const owed = total + amendmentsDelta(rows)
      const coveredByOther = !!b.payer_id && b.payer_id !== uid && b.user_id === uid
      const discountLabels = new Map(discountCatalog.map(x => [x.id, x.label]))
      return {
        booking: b,
        event,
        payments: bookingPayments,
        charges: resolveCharges({ details: b.details as BookingDetails, event, ...catalog }),
        amendments: rows.map(a => ({ label: a.note, amount: a.amount })),
        discounts: (discountsByBooking.get(b.id) ?? []).map(r => ({
          id: r.id,
          label: discountLabels.get(r.discount_id) ?? '',
          status: r.status,
          amount: r.amount,
        })),
        total,
        owed,
        deposit,
        paid,
        credit,
        feeKept: keptVisibleTo(uid, b, parentOf)
          ? cancellationKept(paid, returnedCredits, b.id)
          : null,
        due: Math.max(0, owed - paid - credit),
        depositDue: depositDue(deposit, owed, paid),
        ownerName: nameById.get(b.user_id) ?? '(diver)',
        coveredByName: coveredByOther ? (b.payer_id ? nameById.get(b.payer_id) ?? '(lead booker)' : null) : null,
      }
    })
    setLines(lineData)
    setCreditRows(credits)
    // Account credit = awarded credits + overpayments across active bookings,
    // excluding bookings a lead booker covers (that money is the lead's).
    const covered = new Set(lineData.filter(l => l.coveredByName).map(l => l.booking.id))
    setOpenCredit(diverCreditBalance(
      credits,
      lineData
        .filter(l => l.booking.status !== 'cancelled')
        .map(l => ({ id: l.booking.id, owed: l.owed, paid: l.paid })),
      covered,
    ))
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

  async function applyCredit(bookingId: string, amount: number) {
    setApplying(bookingId)
    try {
      const applied = await applyCreditToBooking({ bookingId, amount })
      if (applied > 0) toast.success(t.payments.applied(`${currency} ${applied.toLocaleString()}`))
      else toast.info(t.payments.nothingToApply)
      if (user) await refetch(user.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.payments.couldNotApply)
    } finally {
      setApplying(null)
    }
  }

  // One-tap spend of the diver's spendable credit across their own due
  // bookings, oldest first. Each RPC call settles credit rows server-side, so
  // awaiting them in sequence lets the pool drain accurately without a refetch
  // between calls — the next call only takes what's still open.
  async function applyCreditToBalances() {
    setApplyingAll(true)
    try {
      const targets = sweepTargets
      let total = 0
      for (const l of targets) {
        total += await applyCreditToBooking({ bookingId: l.booking.id, amount: l.due })
      }
      if (total > 0) toast.success(t.payments.applied(`${currency} ${total.toLocaleString()}`))
      else toast.info(t.payments.nothingToApply)
      if (user) await refetch(user.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.payments.couldNotApply)
    } finally {
      setApplyingAll(false)
    }
  }

  const uid = user?.id
  const active = lines.filter(l => l.booking.status !== 'cancelled')
  // Cancelled bookings still carry real payment history — what was paid, what
  // was refunded, and any credit returned. Hiding them made a diver's record
  // look like money had simply vanished, so they get their own read-only
  // section rather than being dropped from the page.
  const cancelledLines = lines.filter(l => l.booking.status === 'cancelled')
  // Bookings a lead booker pays on my behalf — shown read-only, I owe nothing.
  const coveredMine = active.filter(l => l.coveredByName)
  // Bookings I pay as the lead booker (my own + family members'), rolled up
  // into one balance per group.
  const leadPaid = active.filter(l => uid && l.booking.payer_id === uid)
  // My ordinary solo bookings (no lead-payer designation).
  const ownLines = active.filter(l => uid && l.booking.user_id === uid && !l.booking.payer_id)

  const groupMap = new Map<string, BookingLine[]>()
  for (const l of leadPaid) {
    const key = l.booking.group_id ?? l.booking.id
    const arr = groupMap.get(key) ?? []
    arr.push(l)
    groupMap.set(key, arr)
  }
  const leadGroups = [...groupMap.entries()]

  // Summary totals cover what the viewer is responsible for: their own
  // bookings plus the groups they lead. Covered-by-someone-else is excluded.
  const payable = [...ownLines, ...leadPaid]
  const totalOwed = payable.reduce((s, l) => s + l.due, 0)
  // What is standing between the diver and a confirmed spot: the balance of
  // every booking whose deposit has not landed yet.
  //
  // The balance, not the deposit amount — a booking is unconfirmed as a whole,
  // and the figure a diver acts on is what that booking still costs. `l.event`
  // keeps it to real event bookings, and `depositDue > 0` is both "this one
  // takes a deposit" and "it has not been covered": a booking with no deposit
  // scores zero, so it cannot be counted here.
  //
  // With nothing yet confirmed this equals Balance due, and every deposit that
  // lands moves a booking out of it.
  const awaitingDeposit = payable.filter(l => l.event && l.depositDue > 0)
  const totalDepositDue = awaitingDeposit.reduce((s, l) => s + l.due, 0)
  const currency = lines.find(l => l.event)?.event?.currency ?? siteConfig.locale.currency
  // The bookings the one-tap sweep will actually visit, in the order it visits
  // them: the diver's own solo bookings with a balance, oldest first.
  const sweepTargets = ownLines
    .filter(l => l.due > 0)
    .sort((a, b) => new Date(a.booking.created_at).getTime() - new Date(b.booking.created_at).getTime())
  // What that sweep will really spend. Not min(pool, totalOwed): the sweep
  // skips groups this diver leads, and the RPC refuses to spend a booking's
  // own tied credit against itself.
  const sweepAmount = plannedCreditApplication(creditRows, sweepTargets.map(l => ({ id: l.booking.id, due: l.due })))

  if (loading) {
    return <PageLoading />
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-white">{t.payments.title}</h1>

      {openCredit > 0 && (
        <div className="bg-emerald-50 border border-emerald-400 rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold text-emerald-900">
            {t.payments.accountCredit(`${currency} ${openCredit.toLocaleString()}`)}
          </p>
          {sweepAmount > 0 ? (
            <>
              <p className="text-xs text-emerald-900">
                {t.payments.useCreditHint}
              </p>
              <button
                type="button"
                disabled={applyingAll}
                onClick={applyCreditToBalances}
                className={`${BTN_PRIMARY} text-xs py-1.5 px-3 disabled:opacity-50`}
              >
                {applyingAll
                  ? t.payments.applying
                  : t.payments.useCreditButton(`${currency} ${sweepAmount.toLocaleString()}`)}
              </button>
            </>
          ) : (
            <p className="text-xs text-emerald-900">
              {t.payments.creditOwedHint}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Summary label={t.payments.depositsDue} value={totalDepositDue} currency={currency} accent="text-red-600" />
        <Summary label={t.payments.balanceDueLabel} value={totalOwed} currency={currency} accent="text-red-600" />
      </div>

      {/* Why a deposit is the number that matters: until it lands the booking
          is only held, and a diver reading "Balance due" alone has no way to
          know that the first slice of it is what secures the spot. */}
      <p className="text-xs text-white/80">{t.payments.depositConfirmsNote}</p>

      {active.length === 0 ? (
        <section>
          <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>{t.payments.perBooking}</h2>
          <p className={`${PAGE_BODY} text-sm`}>{t.payments.noActive}</p>
        </section>
      ) : (
        <>
          {leadGroups.length > 0 && (
            <section>
              <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>
                {t.payments.groupPaying}
              </h2>
              <div className="space-y-2">
                {leadGroups.map(([key, groupLines]) => (
                  <GroupCard
                    key={key}
                    lines={groupLines}
                    currency={currency}
                    selfId={uid ?? null}
                    open={expanded === `group:${key}`}
                    onToggle={() => setExpanded(expanded === `group:${key}` ? null : `group:${key}`)}
                  />
                ))}
              </div>
            </section>
          )}

          {ownLines.length > 0 && (
            <section>
              <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>{t.payments.perBooking}</h2>
              <div className="space-y-2">
                {ownLines.map(l => (
                  <LineCard
                    key={l.booking.id}
                    line={l}
                    currency={currency}
                    spendable={Math.max(0, openCreditBalance(creditRows) - openCreditForBooking(creditRows, l.booking.id))}
                    applying={applying === l.booking.id}
                    open={expanded === l.booking.id}
                    onToggle={() => setExpanded(expanded === l.booking.id ? null : l.booking.id)}
                    onRefund={requestRefund}
                    onApplyCredit={applyCredit}
                  />
                ))}
              </div>
            </section>
          )}

          {coveredMine.length > 0 && (
            <section>
              <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>
                {t.payments.paidByLead}
              </h2>
              <div className="space-y-2">
                {coveredMine.map(l => <CoveredCard key={l.booking.id} line={l} currency={currency} />)}
              </div>
            </section>
          )}
        </>
      )}

      {cancelledLines.length > 0 && (
        <section>
          <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-1`}>
            {t.payments.cancelledSection}
          </h2>
          <p className={`text-xs ${TEXT_SUBTLE} mb-2`}>{t.payments.cancelledHint}</p>
          <div className="space-y-2">
            {cancelledLines.map(l => (
              <LineCard
                key={l.booking.id}
                line={l}
                currency={currency}
                spendable={0}
                applying={false}
                open={expanded === l.booking.id}
                onToggle={() => setExpanded(expanded === l.booking.id ? null : l.booking.id)}
                onRefund={requestRefund}
                onApplyCredit={applyCredit}
              />
            ))}
          </div>
        </section>
      )}

      <p className={`text-xs ${TEXT_SUBTLE} text-center`}>
        {t.payments.footer}
      </p>
    </div>
  )
}

function ApplyCreditControl({
  max, currency, busy, onApply,
}: {
  max: number
  currency: string
  busy: boolean
  onApply: (amount: number) => void
}) {
  const [amount, setAmount] = useState<number>(max)
  const clamped = Math.min(Math.max(0, amount || 0), max)

  return (
    <div className="bg-emerald-50 border border-emerald-400 rounded-lg p-3 space-y-2">
      <p className="text-xs text-emerald-900">
        {t.payments.haveCredit(`${currency} ${max.toLocaleString()}`)}
      </p>
      <div className="flex items-center gap-2">
        <span className={`text-xs ${TEXT_MUTED}`}>{currency}</span>
        <input
          type="number"
          aria-label={t.payments.creditAmountAria}
          min={1}
          max={max}
          value={amount}
          onChange={e => setAmount(Number(e.target.value))}
          className="flex-1 min-w-0 rounded-md border border-emerald-400 px-2 py-1 text-sm text-emerald-900"
        />
        <button
          type="button"
          disabled={busy || clamped <= 0}
          onClick={() => onApply(clamped)}
          className={`${BTN_PRIMARY} text-xs py-1.5 px-3 disabled:opacity-50`}
        >
          {busy ? t.payments.applying : t.payments.applyCredit}
        </button>
      </div>
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
  line, currency, spendable, applying, open, onToggle, onRefund, onApplyCredit,
}: {
  line: BookingLine
  currency: string
  spendable: number
  applying: boolean
  open: boolean
  onToggle: () => void
  onRefund: (id: string) => void
  onApplyCredit: (id: string, amount: number) => void
}) {
  const { booking, event, charges, amendments, discounts, total, owed, deposit, paid, credit, feeKept, due, depositDue, payments } = line
  const label = event?.title ?? t.payments.eventFallback
  const refundRequested = !!booking.refund_requested_at
  // Mirror BookingsPage: no refund request on an already-cancelled booking —
  // the admin refund surfaces only list non-cancelled bookings, so a request
  // made here would otherwise be invisible to admins.
  const canRefundDeposit = paid > 0 && !refundRequested && booking.status !== 'cancelled'
  const isCancelled = booking.status === 'cancelled'
  // What this booking can absorb from the diver's spendable credit pool:
  // its outstanding balance, capped by credit not already offsetting it. A
  // cancelled booking absorbs nothing — the RPC refuses it outright.
  const applicable = isCancelled ? 0 : Math.min(due, spendable)
  // Balance nets open credit-for-this-event against what's owed (incl.
  // amendments). A negative balance — awarded credit or overpayment — is money
  // the shop owes the diver, shown as a credit. A cancelled booking owes
  // nothing regardless of its frozen figures.
  const bal = bookingBalance(owed, paid, credit, { cancelled: isCancelled })

  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-surface-50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${TEXT_HEADING} text-sm`}>{label}</p>
          {event && (
            <p className={`text-xs ${TEXT_MUTED} mt-0.5`}>{formatEventSpan(event, { withYear: true })}</p>
          )}
          <p className={`text-xs capitalize mt-0.5 font-medium ${STATUS_STYLES[booking.status]}`}>{booking.status}</p>
          {/* A shop-side cancellation never touches booking.status, so without
              this the card reads as an ordinary live booking — and the credit
              that appears alongside it has no visible explanation. */}
          {event?.cancelled_at && (
            <p className={`text-xs ${TEXT_ERROR} mt-0.5`}>{t.payments.eventCancelledNotice}</p>
          )}
          {refundRequested && (
            <p className={`text-xs ${TEXT_ERROR} mt-0.5`}>🔄 {t.bookings.refundRequested}</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          {total > 0 ? (
            <>
              <p className={`text-sm font-semibold ${TEXT_HEADING}`}>{currency} {total.toLocaleString()}</p>
              {bal.state === 'due' && <p className={`text-xs ${TEXT_ERROR}`}>{currency} {bal.amount.toLocaleString()} {t.bookings.due}</p>}
              {bal.state === 'credit' && <p className="text-xs text-emerald-700 font-semibold">{currency} {bal.amount.toLocaleString()} {t.bookings.creditWord}</p>}
              {bal.state === 'settled' && <p className="text-xs text-brand-900 font-semibold">{t.payments.paidInFull}</p>}
            </>
          ) : <p className={`text-xs ${TEXT_SUBTLE}`}>—</p>}
          <p className={`text-xs ${TEXT_SUBTLE} mt-0.5`}>{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-surface-200 pt-3 space-y-3 text-sm">
          {discounts.length > 0 && (
            <div className="space-y-1">
              <p className={`text-xs ${TEXT_MUTED} uppercase tracking-wider`}>{t.payments.discountsHeading}</p>
              <ul className="space-y-0.5">
                {discounts.map(d => (
                  <li key={d.id} className={`flex justify-between gap-2 text-xs ${TEXT_BODY}`}>
                    <span className="min-w-0 truncate">{d.label}</span>
                    <span className="shrink-0">
                      {d.status === 'approved'
                        ? `${t.discounts.statusApproved} · ${currency} ${(d.amount ?? 0).toLocaleString()}`
                        : d.status === 'rejected'
                          ? t.discounts.statusRejected
                          : t.discounts.statusRequested}
                    </span>
                  </li>
                ))}
              </ul>
              {/* An approved discount is already in the charge breakdown as an
                  adjustment; a pending one is in no figure on this card at all,
                  and saying so is the difference between a balance that looks
                  wrong and one that is waiting. */}
              {discounts.some(d => d.status === 'requested') && (
                <p className={`text-xs ${TEXT_SUBTLE}`}>{t.payments.discountPending}</p>
              )}
            </div>
          )}

          {(charges.length > 0 || amendments.length > 0)
            ? <ChargeBreakdown lines={charges} amendments={amendments} currency={currency} total={owed} />
            : total > 0 && (
                <div className={`flex justify-between ${TEXT_BODY}`}>
                  <span>{t.bookings.total}</span>
                  <span>{currency} {total.toLocaleString()}</span>
                </div>
              )}
          {deposit > 0 && (
            <div className="flex justify-between">
              <span className={TEXT_BODY}>{t.bookings.deposit}</span>
              <span className={depositDue > 0 ? `${TEXT_ERROR} font-medium` : 'text-brand-900 font-semibold'}>
                {/* Once covered, say so — and state the deposit that actually
                    applied. A discount can clamp it below the frozen figure, so
                    showing `deposit` here would claim more was paid than was. */}
                {depositDue > 0
                  ? `${currency} ${depositDue.toLocaleString()} ${t.bookings.due}`
                  : `${currency} ${Math.min(deposit, owed).toLocaleString()} ${t.payments.paidCheck}`}
              </span>
            </div>
          )}
          {paid > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>{t.payments.paid}</span>
              <span className="text-brand-900 font-semibold">{currency} {paid.toLocaleString()}</span>
            </div>
          )}
          {credit > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>{t.bookings.creditThisEvent}</span>
              <span className="text-emerald-700 font-semibold">{currency} {credit.toLocaleString()}</span>
            </div>
          )}
          {/* The shop kept part of what this diver paid. They are told outright,
              on the booking it came off — a withheld fee that only surfaces as
              a refund that never arrives is how a diver finds out by noticing. */}
          {isCancelled && booking.cancellation_settled_at && !!feeKept && feeKept > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>{t.bookings.cancellationFeeKept}</span>
              <span className="text-amber-800 font-semibold">{currency} {feeKept.toLocaleString()}</span>
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

          <div className={`text-xs ${TEXT_SUBTLE} pt-2 border-t border-surface-200`}>
            {t.bookings.bookedLabel} {format(shopZoned(new Date(booking.created_at)), 'MMM d, yyyy')}
          </div>

          {payments.length === 0 && isCancelled && (
            <p className={`text-xs ${TEXT_SUBTLE}`}>{t.payments.noPaymentsRecorded}</p>
          )}

          {payments.length > 0 && (
            <div className="space-y-1">
              <p className={`text-xs ${TEXT_MUTED} uppercase tracking-wider`}>{t.payments.paymentHistory}</p>
              {payments.map(p => (
                <div key={p.id} className="flex justify-between text-xs gap-2">
                  {/* The reference is the diver's half of the receipt: it is
                      what lets them match a line here to their own bank or
                      PayPal statement without asking the shop. */}
                  <span className={`${TEXT_MUTED} min-w-0 break-words`}>
                    {format(shopZoned(new Date(p.created_at)), 'MMM d')}{p.method && ` · ${p.method}`}
                    {p.reference && ` · ${t.admin.bookingPayments.refShort(p.reference)}`}
                  </span>
                  <span className={`${PAYMENT_STATUS_STYLES[p.status]} capitalize`}>
                    {currency} {p.amount.toLocaleString()} · {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {applicable > 0 && (
            <ApplyCreditControl
              max={applicable}
              currency={currency}
              busy={applying}
              onApply={amount => onApplyCredit(booking.id, amount)}
            />
          )}

          {canRefundDeposit && (
            <button onClick={() => onRefund(booking.id)} className={`w-full ${BTN_GHOST} text-xs py-2`}>
              {t.payments.requestDepositRefund}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** One consolidated card for a group the viewer pays for as the lead booker:
 *  combined owed/paid/balance across every sibling booking, expandable to the
 *  per-diver lines. The lead settles the whole balance in one payment (the
 *  shop records it); there are no per-line refund / apply-credit controls. */
function GroupCard({
  lines, currency, selfId, open, onToggle,
}: {
  lines: BookingLine[]
  currency: string
  selfId: string | null
  open: boolean
  onToggle: () => void
}) {
  const owed = lines.reduce((s, l) => s + l.owed, 0)
  const paid = lines.reduce((s, l) => s + l.paid, 0)
  const credit = lines.reduce((s, l) => s + l.credit, 0)
  const bal = bookingBalance(owed, paid, credit)
  const divers = [...new Set(lines.map(l => (selfId && l.booking.user_id === selfId) ? t.payments.you : l.ownerName))]

  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-surface-50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${TEXT_HEADING} text-sm`}>{t.payments.groupOf(lines.length)}</p>
          <p className={`text-xs ${TEXT_MUTED} mt-0.5 truncate`}>{divers.join(', ')}</p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <p className={`text-sm font-semibold ${TEXT_HEADING}`}>{currency} {owed.toLocaleString()}</p>
          {bal.state === 'due' && <p className={`text-xs ${TEXT_ERROR}`}>{currency} {bal.amount.toLocaleString()} {t.bookings.due}</p>}
          {bal.state === 'credit' && <p className="text-xs text-emerald-700 font-semibold">{currency} {bal.amount.toLocaleString()} {t.bookings.creditWord}</p>}
          {bal.state === 'settled' && <p className="text-xs text-brand-900 font-semibold">{t.payments.paidInFull}</p>}
          <p className={`text-xs ${TEXT_SUBTLE} mt-0.5`}>{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-surface-200 pt-3 space-y-2 text-sm">
          {lines.map(l => {
            const lb = bookingBalance(l.owed, l.paid, l.credit)
            return (
              <div key={l.booking.id} className="flex items-baseline justify-between gap-3">
                <span className={`${TEXT_BODY} min-w-0`}>
                  <span className="font-medium">{l.event?.title ?? t.payments.eventFallback}</span>
                  <span className={`${TEXT_SUBTLE} text-xs`}> · {(selfId && l.booking.user_id === selfId) ? t.payments.you : l.ownerName}</span>
                </span>
                <span className="shrink-0 text-xs">
                  {lb.state === 'due' && <span className={TEXT_ERROR}>{currency} {lb.amount.toLocaleString()} {t.bookings.due}</span>}
                  {lb.state === 'settled' && <span className="text-brand-900 font-semibold">{t.payments.paidShort}</span>}
                  {lb.state === 'credit' && <span className="text-emerald-700 font-semibold">{currency} {lb.amount.toLocaleString()} {t.bookings.creditWord}</span>}
                </span>
              </div>
            )
          })}
          <div className={`flex justify-between font-semibold pt-2 border-t border-surface-200 ${TEXT_BODY}`}>
            <span>{t.payments.groupBalance}</span>
            {bal.state === 'due' && <span className={TEXT_ERROR}>{currency} {bal.amount.toLocaleString()} {t.bookings.due}</span>}
            {bal.state === 'credit' && <span className="text-emerald-700">{currency} {bal.amount.toLocaleString()} {t.bookings.creditWord}</span>}
            {bal.state === 'settled' && <span className="text-brand-900">{t.bookings.settled}</span>}
          </div>
          <p className={`text-xs ${TEXT_SUBTLE}`}>
            {t.payments.groupFooter}
          </p>
        </div>
      )}
    </div>
  )
}

/** A booking someone else (the group lead) is paying for. Read-only: the
 *  viewer owes nothing here, so no balance figure or payment controls. */
function CoveredCard({ line, currency }: { line: BookingLine; currency: string }) {
  const { event, total } = line
  return (
    <div className={`${CARD} p-4 flex items-start justify-between gap-3`}>
      <div className="min-w-0">
        <p className={`font-medium ${TEXT_HEADING} text-sm`}>{event?.title ?? t.payments.eventFallback}</p>
        {event && <p className={`text-xs ${TEXT_MUTED} mt-0.5`}>{formatEventSpan(event, { withYear: true })}</p>}
        <p className="text-xs text-emerald-700 font-semibold mt-0.5">{t.payments.coveredBy(line.coveredByName ?? '')}</p>
      </div>
      <div className="text-right shrink-0">
        {total > 0 && <p className={`text-sm ${TEXT_SUBTLE} line-through`}>{currency} {total.toLocaleString()}</p>}
        <p className="text-xs text-brand-900 font-semibold">{t.payments.nothingDue}</p>
      </div>
    </div>
  )
}
