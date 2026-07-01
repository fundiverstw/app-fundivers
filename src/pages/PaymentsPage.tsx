import { useEffect, useState } from 'react'
import { siteConfig } from '../config/site'
import { STATUS_STYLES } from '../lib/booking-status'
import { PageLoading } from '../components/ui/Spinner'
import { format } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { personName } from '../lib/names'
import { fetchEventsForBookings, formatEventSpan } from '../lib/events'
import { fetchCreditsForUser, openCreditForBooking, openCreditBalance, diverCreditBalance, applyCreditToBooking } from '../lib/credits'
import { useToast } from '../hooks/useToast'
import { bookingBalance } from '../lib/booking-balance'
import { resolveCharges, type ChargeLine } from '../lib/booking-charges'
import { fetchChargeCatalog } from '../lib/booking-charge-catalog'
import { fetchAmendmentsForBookings, amendmentsDelta } from '../lib/booking-amendments'
import { ChargeBreakdown, type AmendmentLine } from '../components/ChargeBreakdown'
import type { AppEvent, Booking, BookingDetails, Credit, Payment } from '../types/database'
import {
  CARD, BTN_GHOST, BTN_PRIMARY, TEXT_HEADING, TEXT_BODY, TEXT_MUTED, TEXT_SUBTLE, TEXT_ERROR, PAGE_BODY,
} from '../styles/tokens'

interface BookingLine {
  booking: Booking
  event: AppEvent | null
  payments: Payment[]
  charges: ChargeLine[]
  amendments: AmendmentLine[]
  total: number
  /** total + amendments — what the diver actually owes before payments. */
  owed: number
  deposit: number
  paid: number
  /** Open credit awarded for this event — offsets what's owed. */
  credit: number
  due: number
  depositDue: number
  /** Display name of the diver this booking belongs to (for the lead's
   *  group rollup, where siblings belong to different family members). */
  ownerName: string
  /** Display name of the lead booker paying for this booking, when someone
   *  other than the viewer covers it. Null otherwise. */
  coveredByName: string | null
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

    const diveIds = bookings.map(b => b.eo_dive_id).filter((x): x is string => !!x)
    const courseIds = bookings.map(b => b.eo_course_id).filter((x): x is string => !!x)
    const [paymentsRes, profilesRes, eventMap, catalog, amendmentsByBooking] = await Promise.all([
      bookingIds.length
        ? supabase.from('payments').select('*').in('booking_id', bookingIds)
        : Promise.resolve({ data: [] as Payment[] }),
      supabase.from('profiles').select('id, name, nickname').in('id', personIds),
      (diveIds.length || courseIds.length)
        ? fetchEventsForBookings(diveIds, courseIds)
        : Promise.resolve(new Map<string, AppEvent>()),
      fetchChargeCatalog(bookings.map(b => b.details as BookingDetails)),
      fetchAmendmentsForBookings(bookings.map(b => b.id)),
    ])
    const payRows = (paymentsRes.data ?? []) as Payment[]
    const nameById = new Map<string, string>(
      (profilesRes.data ?? []).map(p => [p.id, personName(p.name, p.nickname) || '(diver)']),
    )

    const paymentsByBooking = new Map<string, Payment[]>()
    for (const p of payRows) {
      if (!p.booking_id) continue
      const arr = paymentsByBooking.get(p.booking_id) ?? []
      arr.push(p)
      paymentsByBooking.set(p.booking_id, arr)
    }

    const lineData: BookingLine[] = bookings.map(b => {
      const eventId = b.eo_dive_id ?? b.eo_course_id ?? ''
      const event = eventMap.get(eventId) ?? null
      const d = (b.details ?? {}) as { total?: number; deposit?: number }
      const total = Number(d.total ?? 0)
      const deposit = Number(d.deposit ?? 0)
      const bookingPayments = paymentsByBooking.get(b.id) ?? []
      const paid = bookingPayments.filter(p => p.status === 'paid').reduce((s, p) => s + p.amount, 0)
      const credit = openCreditForBooking(credits, b.id)
      const rows = amendmentsByBooking.get(b.id) ?? []
      const owed = total + amendmentsDelta(rows)
      const coveredByOther = !!b.payer_id && b.payer_id !== uid && b.user_id === uid
      return {
        booking: b,
        event,
        payments: bookingPayments,
        charges: resolveCharges({ details: b.details as BookingDetails, event, ...catalog }),
        amendments: rows.map(a => ({ label: a.note, amount: a.amount })),
        total,
        owed,
        deposit,
        paid,
        credit,
        due: Math.max(0, owed - paid - credit),
        depositDue: Math.max(0, deposit - paid),
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
      if (applied > 0) toast.success(`Applied ${currency} ${applied.toLocaleString()} credit`)
      else toast.info('Nothing to apply')
      if (user) await refetch(user.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply credit')
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
      const targets = lines
        .filter(l => uid && l.booking.user_id === uid && !l.booking.payer_id
          && l.booking.status !== 'cancelled' && l.due > 0)
        .sort((a, b) => new Date(a.booking.created_at).getTime() - new Date(b.booking.created_at).getTime())
      let total = 0
      for (const l of targets) {
        total += await applyCreditToBooking({ bookingId: l.booking.id, amount: l.due })
      }
      if (total > 0) toast.success(`Applied ${currency} ${total.toLocaleString()} credit`)
      else toast.info('Nothing to apply')
      if (user) await refetch(user.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not apply credit')
    } finally {
      setApplyingAll(false)
    }
  }

  const uid = user?.id
  const active = lines.filter(l => l.booking.status !== 'cancelled')
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
  const totalDepositDue = payable.reduce((s, l) => s + l.depositDue, 0)
  const totalPaid = payable.reduce((s, l) => s + l.paid, 0)
  const currency = lines.find(l => l.event)?.event?.currency ?? siteConfig.locale.currency
  // Open credit the diver can actually spend via the RPC (awarded credit rows,
  // excluding overpayment-derived balance which has no row to consume). The
  // top-level apply button only surfaces when there's both a pool and a due
  // own-booking to spend it against.
  const spendablePool = openCreditBalance(creditRows)
  const hasDueOwn = ownLines.some(l => l.due > 0)

  if (loading) {
    return <PageLoading />
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-xl font-bold text-white">Payments</h1>

      {openCredit > 0 && (
        <div className="bg-emerald-50 border border-emerald-400 rounded-lg p-3 space-y-2">
          <p className="text-sm font-semibold text-emerald-900">
            Account credit: {currency} {openCredit.toLocaleString()}
          </p>
          {spendablePool > 0 && hasDueOwn ? (
            <>
              <p className="text-xs text-emerald-900">
                Use it toward what you owe — we'll apply it across your booking
                balances, oldest first. Anything left over stays on your account.
              </p>
              <button
                type="button"
                disabled={applyingAll}
                onClick={applyCreditToBalances}
                className={`${BTN_PRIMARY} text-xs py-1.5 px-3 disabled:opacity-50`}
              >
                {applyingAll
                  ? 'Applying…'
                  : `Use ${currency} ${Math.min(spendablePool, totalOwed).toLocaleString()} credit on your balance`}
              </button>
            </>
          ) : (
            <p className="text-xs text-emerald-900">
              We owe you this much — usually from a cancelled event. Open any
              booking with a balance due below to apply it.
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Summary label="Deposits due" value={totalDepositDue} currency={currency} accent="text-red-600" />
        <Summary label="Balance due"  value={totalOwed}       currency={currency} accent="text-red-600" />
        <Summary label="Total paid"   value={totalPaid}       currency={currency} accent="text-brand-900" />
      </div>

      {active.length === 0 ? (
        <section>
          <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>Per booking</h2>
          <p className={`${PAGE_BODY} text-sm`}>No active bookings yet. Check the calendar!</p>
        </section>
      ) : (
        <>
          {leadGroups.length > 0 && (
            <section>
              <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>
                Group bookings — you're paying
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
              <h2 className={`text-sm font-semibold ${TEXT_MUTED} uppercase tracking-wider mb-2`}>Per booking</h2>
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
                Paid by your group lead
              </h2>
              <div className="space-y-2">
                {coveredMine.map(l => <CoveredCard key={l.booking.id} line={l} currency={currency} />)}
              </div>
            </section>
          )}
        </>
      )}

      <p className={`text-xs ${TEXT_SUBTLE} text-center`}>
        Deposit is due up-front to confirm your spot. Balance is settled closer to the event.
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
        You have {currency} {max.toLocaleString()} in account credit you can apply to this balance.
      </p>
      <div className="flex items-center gap-2">
        <span className={`text-xs ${TEXT_MUTED}`}>{currency}</span>
        <input
          type="number"
          aria-label="Credit amount to apply"
          min={1}
          max={max}
          value={amount}
          onChange={e => setAmount(Number(e.target.value))}
          className="flex-1 min-w-0 rounded-md border border-emerald-400 px-2 py-1 text-sm text-brand-950"
        />
        <button
          type="button"
          disabled={busy || clamped <= 0}
          onClick={() => onApply(clamped)}
          className={`${BTN_PRIMARY} text-xs py-1.5 px-3 disabled:opacity-50`}
        >
          {busy ? 'Applying…' : 'Apply credit'}
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
  const { booking, event, charges, amendments, total, owed, deposit, paid, credit, due, depositDue, payments } = line
  const label = event?.title ?? '(event)'
  const refundRequested = !!booking.refund_requested_at
  const canRefundDeposit = paid > 0 && !refundRequested
  // What this booking can absorb from the diver's spendable credit pool:
  // its outstanding balance, capped by credit not already offsetting it.
  const applicable = Math.min(due, spendable)
  // Balance nets open credit-for-this-event against what's owed (incl.
  // amendments). A negative balance — awarded credit or overpayment — is money
  // the shop owes the diver, shown as a credit.
  const bal = bookingBalance(owed, paid, credit)

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
          {refundRequested && (
            <p className={`text-xs ${TEXT_ERROR} mt-0.5`}>🔄 Refund requested</p>
          )}
        </div>
        <div className="text-right shrink-0 ml-3">
          {total > 0 ? (
            <>
              <p className={`text-sm font-semibold ${TEXT_HEADING}`}>{currency} {total.toLocaleString()}</p>
              {bal.state === 'due' && <p className={`text-xs ${TEXT_ERROR}`}>{currency} {bal.amount.toLocaleString()} due</p>}
              {bal.state === 'credit' && <p className="text-xs text-emerald-700 font-semibold">{currency} {bal.amount.toLocaleString()} credit</p>}
              {bal.state === 'settled' && <p className="text-xs text-brand-900 font-semibold">Paid in full</p>}
            </>
          ) : <p className={`text-xs ${TEXT_SUBTLE}`}>—</p>}
          <p className={`text-xs ${TEXT_SUBTLE} mt-0.5`}>{open ? '▲' : '▼'}</p>
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-surface-200 pt-3 space-y-3 text-sm">
          {(charges.length > 0 || amendments.length > 0)
            ? <ChargeBreakdown lines={charges} amendments={amendments} currency={currency} total={owed} />
            : total > 0 && (
                <div className={`flex justify-between ${TEXT_BODY}`}>
                  <span>Total</span>
                  <span>{currency} {total.toLocaleString()}</span>
                </div>
              )}
          {deposit > 0 && (
            <div className="flex justify-between">
              <span className={TEXT_BODY}>Deposit</span>
              <span className={depositDue > 0 ? `${TEXT_ERROR} font-medium` : 'text-brand-900 font-semibold'}>
                {depositDue > 0
                  ? `${currency} ${depositDue.toLocaleString()} due`
                  : `${currency} ${deposit.toLocaleString()} paid ✓`}
              </span>
            </div>
          )}
          {paid > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>Paid</span>
              <span className="text-brand-900 font-semibold">{currency} {paid.toLocaleString()}</span>
            </div>
          )}
          {credit > 0 && (
            <div className={`flex justify-between ${TEXT_BODY}`}>
              <span>Credit (this event)</span>
              <span className="text-emerald-700 font-semibold">{currency} {credit.toLocaleString()}</span>
            </div>
          )}
          {total > 0 && (
            <div className={`flex justify-between font-semibold pt-1 border-t border-surface-200 ${TEXT_BODY}`}>
              <span>Balance</span>
              {bal.state === 'due' && <span className={TEXT_ERROR}>{currency} {bal.amount.toLocaleString()} due</span>}
              {bal.state === 'credit' && <span className="text-emerald-700">{currency} {bal.amount.toLocaleString()} credit</span>}
              {bal.state === 'settled' && <span className="text-brand-900">Settled ✓</span>}
            </div>
          )}

          <div className={`text-xs ${TEXT_SUBTLE} pt-2 border-t border-surface-200`}>
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
              Request deposit refund
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
  const divers = [...new Set(lines.map(l => (selfId && l.booking.user_id === selfId) ? 'You' : l.ownerName))]

  return (
    <div className={CARD}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left p-4 flex items-start justify-between hover:bg-surface-50 rounded-xl transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className={`font-medium ${TEXT_HEADING} text-sm`}>Group of {lines.length} booking{lines.length === 1 ? '' : 's'}</p>
          <p className={`text-xs ${TEXT_MUTED} mt-0.5 truncate`}>{divers.join(', ')}</p>
        </div>
        <div className="text-right shrink-0 ml-3">
          <p className={`text-sm font-semibold ${TEXT_HEADING}`}>{currency} {owed.toLocaleString()}</p>
          {bal.state === 'due' && <p className={`text-xs ${TEXT_ERROR}`}>{currency} {bal.amount.toLocaleString()} due</p>}
          {bal.state === 'credit' && <p className="text-xs text-emerald-700 font-semibold">{currency} {bal.amount.toLocaleString()} credit</p>}
          {bal.state === 'settled' && <p className="text-xs text-brand-900 font-semibold">Paid in full</p>}
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
                  <span className="font-medium">{l.event?.title ?? '(event)'}</span>
                  <span className={`${TEXT_SUBTLE} text-xs`}> · {(selfId && l.booking.user_id === selfId) ? 'You' : l.ownerName}</span>
                </span>
                <span className="shrink-0 text-xs">
                  {lb.state === 'due' && <span className={TEXT_ERROR}>{currency} {lb.amount.toLocaleString()} due</span>}
                  {lb.state === 'settled' && <span className="text-brand-900 font-semibold">Paid ✓</span>}
                  {lb.state === 'credit' && <span className="text-emerald-700 font-semibold">{currency} {lb.amount.toLocaleString()} credit</span>}
                </span>
              </div>
            )
          })}
          <div className={`flex justify-between font-semibold pt-2 border-t border-surface-200 ${TEXT_BODY}`}>
            <span>Group balance</span>
            {bal.state === 'due' && <span className={TEXT_ERROR}>{currency} {bal.amount.toLocaleString()} due</span>}
            {bal.state === 'credit' && <span className="text-emerald-700">{currency} {bal.amount.toLocaleString()} credit</span>}
            {bal.state === 'settled' && <span className="text-brand-900">Settled ✓</span>}
          </div>
          <p className={`text-xs ${TEXT_SUBTLE}`}>
            Pay the group balance in one transfer; the shop records it against everyone.
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
        <p className={`font-medium ${TEXT_HEADING} text-sm`}>{event?.title ?? '(event)'}</p>
        {event && <p className={`text-xs ${TEXT_MUTED} mt-0.5`}>{formatEventSpan(event, { withYear: true })}</p>}
        <p className="text-xs text-emerald-700 font-semibold mt-0.5">Covered by {line.coveredByName}</p>
      </div>
      <div className="text-right shrink-0">
        {total > 0 && <p className={`text-sm ${TEXT_SUBTLE} line-through`}>{currency} {total.toLocaleString()}</p>}
        <p className="text-xs text-brand-900 font-semibold">Nothing due</p>
      </div>
    </div>
  )
}
