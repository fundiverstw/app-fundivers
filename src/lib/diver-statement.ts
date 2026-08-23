import { netPaid } from './payments'
import { amendmentsDelta } from './booking-amendments'
import type { Booking, BookingAmendment, BookingDetails, Credit, Payment } from '../types/database'

// A diver's money history as a bank statement: every event that moved their
// balance, in order, each with the change it made and the balance standing
// after it.
//
// The app had the pieces and no way to read them as a sequence. Payments,
// credits, charges and amendments each lived in their own list, every list
// showed a total, and none of them showed how one total became the next. An
// admin asked "why does this diver have 7,200 in credit" had to reconstruct
// the arithmetic by hand -- which is exactly how a double-counted refund went
// unnoticed for two days.
//
// SIGN CONVENTION: credit-positive. A positive balance is money the shop owes
// the diver; a negative balance is money the diver owes the shop. Being
// charged pushes the balance down, paying pushes it back up.
//
// The closing balance is deliberately UNCLAMPED, which is the one place this
// differs from `diverCreditBalance`. That function asks "how much can this
// diver spend", so it floors each active booking's term at zero -- a diver who
// owes 1,000 on one dive and is 500 ahead on another can spend 500, not -500.
// A statement asking "where does this diver stand" cannot floor anything: the
// running total has to be free to go negative or the lines stop adding up.
// Both figures are shown together, and they agree unless some active booking
// is underpaid.

export type StatementKind =
  | 'charge'
  | 'amendment'
  | 'payment'
  | 'refund'
  | 'payment_void'
  | 'payment_pending'
  | 'credit_issued'
  | 'credit_settled'
  | 'cancellation'

export interface StatementLine {
  /** Stable, unique key -- source row id, suffixed when one row emits two
   *  lines (a credit issues, then settles). */
  id: string
  /** Id of the row this line came from -- payment, credit, amendment or
   *  booking. Lets the UI hang an action (settle a credit, void a payment) on
   *  the line without a second lookup table. */
  sourceId: string
  at: string
  kind: StatementKind
  bookingId: string | null
  /** Change this line made to the balance. Zero on lines that record
   *  something without moving money (see `inert`). */
  delta: number
  /** Balance standing after this line. */
  balance: number
  /** The row's own figure, unsigned, as stored. */
  amount: number
  actorId: string | null
  note: string | null
  /** Payment method, for payment lines. `account_credit` marks a row the
   *  apply-credit RPC wrote rather than money arriving. */
  method: string | null
  /** Receipt / transfer / transaction id, for payment lines. */
  reference: string | null
  /** The line records an act that moved no balance: a voided or pending
   *  payment, or activity on a booking already cancelled (whose charge and
   *  payments stopped counting at the cancellation). Rendered muted so a zero
   *  change reads as deliberate rather than as a bug. */
  inert: boolean
  /** True when `at` is a stand-in rather than a recorded time -- only for a
   *  cancellation the schema never stamped. */
  approximateDate?: boolean
}

export interface DiverStatement {
  lines: StatementLine[]
  /** Closing balance: positive = shop owes the diver, negative = diver owes. */
  balance: number
  /** Totals for the summary block, over the bookings this diver pays for. */
  totals: {
    /** Charged across active bookings (frozen total + amendments). */
    charged: number
    /** Net paid across active bookings (paid - refunded). */
    paid: number
    /** Open credit not consumed by an active booking's balance. */
    openCredit: number
  }
}

export interface StatementInput {
  bookings: Booking[]
  payments: Payment[]
  credits: Credit[]
  amendmentsByBooking: ReadonlyMap<string, BookingAmendment[]>
}

// Tie-break for lines sharing a timestamp, so a statement renders identically
// on every load. A cancellation sorts last: it reverses the lines above it, and
// reversing something before it appears reads as an error.
const KIND_ORDER: Record<StatementKind, number> = {
  charge: 0,
  amendment: 1,
  payment: 2,
  refund: 3,
  payment_void: 4,
  payment_pending: 5,
  cancellation: 6,
  credit_issued: 7,
  credit_settled: 8,
}

type Draft = Omit<StatementLine, 'balance'>

function paymentKind(status: Payment['status']): StatementKind {
  switch (status) {
    case 'paid':     return 'payment'
    case 'refunded': return 'refund'
    case 'voided':   return 'payment_void'
    default:         return 'payment_pending'
  }
}

/**
 * Which bookings' money belongs to this diver?
 *
 * A booking with `payer_id` pointing at someone else is paid by a lead booker.
 * Its charge and its payments are the LEAD's, and `diverCreditBalance` drops
 * them from this diver's account for that reason -- so the statement drops
 * them too. Leaving them in would show a diver a charge they were never
 * expected to settle, and an overpayment that is not theirs to spend.
 */
function paidBySomeoneElse(b: Booking): boolean {
  return !!b.payer_id && b.payer_id !== b.user_id
}

/**
 * When did this booking stop counting?
 *
 * `cancelled_at` is stamped from the status transition (20260823120000), but
 * cancellations predating that migration that the admin audit log never
 * witnessed have none. Rather than drop the reversal -- which would leave the
 * statement's closing balance disagreeing with every other surface -- it is
 * placed at the booking's last recorded activity, flagged so the UI can say
 * the date is a stand-in.
 */
function cancellationPoint(
  booking: Booking, ownLines: Draft[],
): { at: string; approximate: boolean } {
  if (booking.cancelled_at) return { at: booking.cancelled_at, approximate: false }
  const last = ownLines.reduce<string | null>(
    (latest, l) => (latest === null || l.at > latest ? l.at : latest), null,
  )
  return { at: last ?? booking.created_at, approximate: true }
}

/** Build a diver's statement. Pure -- callers fetch, this assembles. */
export function buildDiverStatement(input: StatementInput): DiverStatement {
  const bookings = input.bookings.filter(b => !paidBySomeoneElse(b))
  const ownIds = new Set(bookings.map(b => b.id))
  const drafts: Draft[] = []

  for (const booking of bookings) {
    const details = (booking.details ?? {}) as BookingDetails
    const own: Draft[] = []

    const total = Number(details.total ?? 0)
    if (total !== 0) {
      own.push({
        id: `charge:${booking.id}`,
        sourceId: booking.id,
        at: booking.created_at,
        kind: 'charge',
        bookingId: booking.id,
        delta: -total,
        amount: total,
        actorId: null,
        note: null,
        method: null,
        reference: null,
        inert: false,
      })
    }

    for (const a of input.amendmentsByBooking.get(booking.id) ?? []) {
      own.push({
        id: `amendment:${a.id}`,
        sourceId: a.id,
        at: a.created_at,
        kind: 'amendment',
        bookingId: booking.id,
        // `amount` is signed as a change to what is OWED, so a surcharge
        // pushes the balance down and a discount pushes it up.
        delta: -a.amount,
        amount: Math.abs(a.amount),
        actorId: a.created_by,
        note: a.note,
        method: null,
        reference: null,
        inert: false,
      })
    }

    for (const p of input.payments.filter(p => p.booking_id === booking.id)) {
      const kind = paymentKind(p.status)
      const amount = Number(p.amount)
      own.push({
        id: `payment:${p.id}`,
        sourceId: p.id,
        at: p.created_at,
        kind,
        bookingId: booking.id,
        delta: kind === 'payment' ? amount : kind === 'refund' ? -amount : 0,
        amount,
        actorId: p.recorded_by,
        note: p.note,
        method: p.method,
        reference: p.reference,
        inert: kind === 'payment_void' || kind === 'payment_pending',
      })
    }

    if (booking.status === 'cancelled') {
      // A cancelled booking contributes nothing anywhere: `bookingBalance`
      // reads it as settled and `diverCreditBalance` drops it from the active
      // set. The reversal takes back exactly what it had contributed by the
      // time it was cancelled, and everything charged or paid on it afterwards
      // -- an off-app refund recorded later, say -- lands inert, because the
      // money it concerns left this diver's balance at the cancellation.
      //
      // Credits are the exception and are handled below: a credit tied to a
      // cancelled booking is precisely how the money comes BACK to the diver.
      const point = cancellationPoint(booking, own)
      const undone = own
        .filter(l => l.at <= point.at)
        .reduce((s, l) => s + l.delta, 0)
      for (const line of own) {
        if (line.at > point.at) { line.delta = 0; line.inert = true }
      }
      own.push({
        id: `cancellation:${booking.id}`,
        sourceId: booking.id,
        at: point.at,
        kind: 'cancellation',
        bookingId: booking.id,
        // `-undone` when undone is 0 is negative zero, which renders as "-0".
        delta: undone === 0 ? 0 : -undone,
        amount: Math.abs(undone),
        actorId: booking.cancelled_by,
        // Deliberately no note. The obvious candidate,
        // `cancellation_settled_note`, describes a LATER decision about the
        // money made by a different admin, and hanging it here would credit
        // it to whoever cancelled.
        note: null,
        method: null,
        reference: null,
        inert: undone === 0,
        approximateDate: point.approximate || undefined,
      })
    }

    drafts.push(...own)
  }

  // Credits count wherever they are tied, including to a cancelled booking --
  // that is the shape a refund-as-credit takes. Credits tied to a booking a
  // lead pays for are the lead's money, and drop out with the booking.
  for (const c of input.credits) {
    if (c.booking_id && !ownIds.has(c.booking_id)) continue
    const amount = Number(c.amount)
    drafts.push({
      id: `credit:${c.id}:issued`,
      sourceId: c.id,
      at: c.created_at,
      kind: 'credit_issued',
      bookingId: c.booking_id,
      delta: amount,
      amount,
      actorId: c.created_by,
      note: c.reason,
      method: null,
      reference: null,
      inert: false,
    })
    if (c.status === 'settled' && c.settled_at) {
      drafts.push({
        id: `credit:${c.id}:settled`,
        sourceId: c.id,
        at: c.settled_at,
        kind: 'credit_settled',
        bookingId: c.booking_id,
        delta: -amount,
        amount,
        actorId: c.settled_by,
        note: c.settled_note,
        method: null,
        reference: null,
        inert: false,
      })
    }
  }

  drafts.sort((x, y) =>
    x.at !== y.at ? (x.at < y.at ? -1 : 1)
    : KIND_ORDER[x.kind] !== KIND_ORDER[y.kind] ? KIND_ORDER[x.kind] - KIND_ORDER[y.kind]
    : x.id < y.id ? -1 : x.id > y.id ? 1 : 0)

  let running = 0
  const lines = drafts.map(d => {
    running += d.delta
    return { ...d, balance: running }
  })

  const active = bookings.filter(b => b.status !== 'cancelled')
  const activeIds = new Set(active.map(b => b.id))
  const charged = active.reduce((s, b) => {
    const details = (b.details ?? {}) as BookingDetails
    return s + Number(details.total ?? 0) + amendmentsDelta(input.amendmentsByBooking.get(b.id) ?? [])
  }, 0)
  const paid = netPaid(input.payments.filter(p => p.booking_id && activeIds.has(p.booking_id)))
  const openCredit = input.credits
    .filter(c => c.status === 'open' && (!c.booking_id || ownIds.has(c.booking_id)))
    .reduce((s, c) => s + Number(c.amount), 0)

  return { lines, balance: running, totals: { charged, paid, openCredit } }
}
