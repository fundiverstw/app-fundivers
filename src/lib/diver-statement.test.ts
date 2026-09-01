import { describe, it, expect } from 'vitest'
import { buildDiverStatement } from './diver-statement'
import { diverCreditBalance } from './credits'
import type { Booking, BookingAmendment, Credit, Payment } from '../types/database'

const T = (n: number) => `2026-08-${String(n).padStart(2, '0')}T00:00:00Z`

function booking(over: Partial<Booking> & { id: string }): Booking {
  return {
    id: over.id,
    created_at: T(1),
    user_id: 'diver-1',
    event_id: `ev-${over.id}`,
    status: 'confirmed',
    notes: null,
    details: { total: 3000 },
    refund_requested_at: null,
    cancellation_settled_at: null,
    cancellation_settled_by: null,
    cancellation_settled_note: null,
    cancelled_at: null,
    cancelled_by: null,
    group_id: null,
    payer_id: null,
    continues_booking_id: null,
    attend_days: null,
    ...over,
  } as Booking
}

function payment(over: Partial<Payment> & { id: string }): Payment {
  return {
    id: over.id,
    created_at: T(2),
    user_id: 'diver-1',
    booking_id: 'b1',
    amount: 3000,
    currency: 'TWD',
    status: 'paid',
    method: 'cash',
    note: null,
    reference: 'R-1',
    recorded_by: 'admin-1',
    ...over,
  } as Payment
}

function credit(over: Partial<Credit> & { id: string }): Credit {
  return {
    id: over.id,
    created_at: T(3),
    user_id: 'diver-1',
    booking_id: null,
    amount: 1000,
    currency: 'TWD',
    reason: 'goodwill',
    status: 'open',
    created_by: 'admin-1',
    settled_at: null,
    settled_note: null,
    settled_by: null,
    source: 'manual',
    ...over,
  } as Credit
}

function build(args: {
  bookings?: Booking[]
  payments?: Payment[]
  credits?: Credit[]
  amendments?: Array<[string, BookingAmendment[]]>
}) {
  return buildDiverStatement({
    bookings: args.bookings ?? [],
    payments: args.payments ?? [],
    credits: args.credits ?? [],
    amendmentsByBooking: new Map(args.amendments ?? []),
  })
}

describe('buildDiverStatement', () => {
  it('runs the balance down as the diver is charged and back up as they pay', () => {
    const s = build({
      bookings: [booking({ id: 'b1' })],
      payments: [payment({ id: 'p1', amount: 1000, created_at: T(2) }),
                 payment({ id: 'p2', amount: 2000, created_at: T(3) })],
    })
    expect(s.lines.map(l => [l.kind, l.delta, l.balance])).toEqual([
      ['charge', -3000, -3000],
      ['payment', 1000, -2000],
      ['payment', 2000, 0],
    ])
    expect(s.balance).toBe(0)
  })

  it('goes negative while money is owed — the figure a floored account credit could never show', () => {
    const s = build({ bookings: [booking({ id: 'b1' })] })
    expect(s.balance).toBe(-3000)
    // The spendable figure the app offers for the same diver: nothing, because
    // an underpaid booking cannot lend its shortfall to anything.
    expect(diverCreditBalance([], [{ id: 'b1', owed: 3000, paid: 0 }])).toBe(0)
  })

  it('closes on paid - charged + open credit, so the summary block ties to the last line', () => {
    const s = build({
      bookings: [booking({ id: 'b1', details: { total: 3000 } }),
                 booking({ id: 'b2', details: { total: 2000 } })],
      payments: [payment({ id: 'p1', booking_id: 'b1', amount: 3600 })],
      credits: [credit({ id: 'c1', amount: 500 })],
    })
    const { charged, paid, openCredit } = s.totals
    expect(charged).toBe(5000)
    expect(paid).toBe(3600)
    expect(openCredit).toBe(500)
    expect(s.balance).toBe(paid - charged + openCredit)
    expect(s.lines.at(-1)!.balance).toBe(s.balance)
  })

  it('nets a refund back out of the balance', () => {
    const s = build({
      bookings: [booking({ id: 'b1' })],
      payments: [payment({ id: 'p1', amount: 3000, created_at: T(2) }),
                 payment({ id: 'p2', amount: 500, status: 'refunded', created_at: T(4) })],
    })
    expect(s.balance).toBe(-500)
    expect(s.lines.at(-1)).toMatchObject({ kind: 'refund', delta: -500, balance: -500 })
  })

  it('leaves voided and pending payments in the history with no effect on the balance', () => {
    const s = build({
      bookings: [booking({ id: 'b1' })],
      payments: [payment({ id: 'p1', amount: 3000, status: 'voided', created_at: T(2) }),
                 payment({ id: 'p2', amount: 900, status: 'pending', created_at: T(3) })],
    })
    expect(s.balance).toBe(-3000)
    expect(s.lines.filter(l => l.inert).map(l => l.kind)).toEqual(['payment_void', 'payment_pending'])
  })

  it('applies an amendment against what is owed, not what is paid', () => {
    const discounted = build({
      bookings: [booking({ id: 'b1' })],
      amendments: [['b1', [{ id: 'a1', booking_id: 'b1', amount: -500, note: 'loyalty', created_by: 'admin-2', created_at: T(2) }]]],
    })
    expect(discounted.balance).toBe(-2500)
    expect(discounted.lines[1]).toMatchObject({ kind: 'amendment', delta: 500, actorId: 'admin-2' })
  })
})

describe('a cancelled booking', () => {
  const cancelled = booking({ id: 'b1', status: 'cancelled', cancelled_at: T(5), cancelled_by: 'admin-2' })

  it('takes back both its charge and its payments, so it contributes nothing', () => {
    const s = build({
      bookings: [cancelled],
      payments: [payment({ id: 'p1', amount: 3000, created_at: T(2) })],
    })
    expect(s.balance).toBe(0)
    expect(s.lines.at(-1)).toMatchObject({ kind: 'cancellation', delta: 0, actorId: 'admin-2' })
  })

  it('still counts the credit issued for it — that is how the money comes back', () => {
    const s = build({
      bookings: [cancelled],
      payments: [payment({ id: 'p1', amount: 3000, created_at: T(2) })],
      credits: [credit({
        id: 'c1', booking_id: 'b1', amount: 3000, created_at: T(5),
        source: 'booking_cancellation_return', reason: 'Credit for cancelled booking',
      })],
    })
    expect(s.balance).toBe(3000)
    // 3,000 once, not twice: the credit is the only thing left standing.
    expect(s.lines.filter(l => l.delta === 3000)).toHaveLength(2)
    expect(s.lines.map(l => l.kind)).toEqual(['charge', 'payment', 'cancellation', 'credit_issued'])
  })

  it('records a later off-app refund without moving the balance a second time', () => {
    const s = build({
      bookings: [cancelled],
      payments: [payment({ id: 'p1', amount: 3000, created_at: T(2) }),
                 payment({ id: 'p2', amount: 3000, status: 'refunded', created_at: T(9) })],
    })
    expect(s.balance).toBe(0)
    expect(s.lines.at(-1)).toMatchObject({ kind: 'refund', delta: 0, inert: true })
  })

  it('reverses at the booking’s last activity, flagged, when nothing stamped the cancellation', () => {
    const s = build({
      bookings: [booking({ id: 'b1', status: 'cancelled' })],
      payments: [payment({ id: 'p1', amount: 3000, created_at: T(2) })],
    })
    expect(s.balance).toBe(0)
    expect(s.lines.at(-1)).toMatchObject({ kind: 'cancellation', at: T(2), approximateDate: true })
  })
})

describe('money that is not this diver’s', () => {
  it('drops a booking a lead booker pays for, and the credit tied to it', () => {
    const s = build({
      bookings: [booking({ id: 'b1', payer_id: 'lead-9' })],
      payments: [payment({ id: 'p1', booking_id: 'b1', amount: 5000 })],
      credits: [credit({ id: 'c1', booking_id: 'b1', amount: 2000 })],
    })
    expect(s.lines).toEqual([])
    expect(s.balance).toBe(0)
  })

  it('keeps a booking whose payer_id is the diver themselves', () => {
    const s = build({ bookings: [booking({ id: 'b1', payer_id: 'diver-1' })] })
    expect(s.balance).toBe(-3000)
  })
})

describe('agreement with the spendable-credit figure', () => {
  // The two are the same number whenever no active booking is underpaid, and
  // that is the case the admin reads as "this diver is owed money".
  it('matches diverCreditBalance when every active booking is settled or ahead', () => {
    const bookings = [booking({ id: 'b1', details: { total: 3000 } })]
    const payments = [payment({ id: 'p1', booking_id: 'b1', amount: 4000 })]
    const credits = [credit({ id: 'c1', amount: 250 })]
    const s = build({ bookings, payments, credits })
    const spendable = diverCreditBalance(credits, [{ id: 'b1', owed: 3000, paid: 4000 }])
    expect(s.balance).toBe(spendable)
  })
})

describe('ordering', () => {
  it('places a cancellation after the lines it reverses when they share a timestamp', () => {
    const s = build({
      bookings: [booking({ id: 'b1', created_at: T(4), status: 'cancelled', cancelled_at: T(4) })],
      payments: [payment({ id: 'p1', amount: 3000, created_at: T(4) })],
      credits: [credit({ id: 'c1', booking_id: 'b1', amount: 3000, created_at: T(4) })],
    })
    expect(s.lines.map(l => l.kind)).toEqual(['charge', 'payment', 'cancellation', 'credit_issued'])
    expect(s.balance).toBe(3000)
  })

  it('attributes each line and carries a payment reference through', () => {
    const s = build({
      bookings: [booking({ id: 'b1' })],
      payments: [payment({ id: 'p1', recorded_by: 'admin-7', reference: 'BANK-42' })],
      credits: [credit({
        id: 'c1', created_by: 'admin-8', status: 'settled',
        settled_at: T(6), settled_by: 'admin-9', settled_note: 'applied',
      })],
    })
    expect(s.lines.find(l => l.kind === 'payment')).toMatchObject({ actorId: 'admin-7', reference: 'BANK-42' })
    expect(s.lines.find(l => l.kind === 'credit_issued')).toMatchObject({ actorId: 'admin-8' })
    expect(s.lines.find(l => l.kind === 'credit_settled')).toMatchObject({ actorId: 'admin-9', delta: -1000 })
  })
})

describe('an account charge', () => {
  const charge = (over: Partial<Credit> & { id: string }) =>
    credit({ source: 'admin_charge', reason: 'Mask bought in the shop', ...over })

  it('reads as a charge, not a credit, and pushes the balance down', () => {
    const s = build({ credits: [charge({ id: 'c1', amount: -1200, created_at: T(4) })] })
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0]).toMatchObject({ kind: 'account_charge', delta: -1200, amount: 1200, balance: -1200 })
  })

  it('nets against credit in the closing balance and the totals', () => {
    const s = build({
      credits: [
        credit({ id: 'c1', amount: 3000, created_at: T(3) }),
        charge({ id: 'c2', amount: -1200, created_at: T(4) }),
      ],
    })
    expect(s.balance).toBe(1800)
    expect(s.totals.openCredit).toBe(1800)
    // The identity the summary block is built on still holds with a charge.
    expect(s.balance).toBe(s.totals.paid - s.totals.charged + s.totals.openCredit)
  })

  it('can put a diver who owes nothing on any booking into the red', () => {
    const s = build({
      bookings: [booking({ id: 'b1', details: { total: 3000 } })],
      payments: [payment({ id: 'p1', booking_id: 'b1', amount: 3000 })],
      credits: [charge({ id: 'c1', amount: -1200, created_at: T(6) })],
    })
    expect(s.balance).toBe(-1200)
    expect(s.lines.at(-1)).toMatchObject({ kind: 'account_charge', balance: -1200 })
  })
})

// A refund is the same negative row as a charge and the opposite story: the
// shop handed money back rather than sold something. The statement is where
// that difference has to survive, because the arithmetic cannot carry it.
describe('an account refund', () => {
  const refund = (over: Partial<Credit> & { id: string }) =>
    credit({ source: 'admin_refund', reason: 'Bank transfer #4821', ...over })
  const charge = (over: Partial<Credit> & { id: string }) =>
    credit({ source: 'admin_charge', reason: 'Mask bought in the shop', ...over })

  it('reads as a refund rather than a charge, and takes the credit back off', () => {
    const s = build({
      credits: [
        credit({ id: 'c1', amount: 3000, created_at: T(3) }),
        refund({ id: 'c2', amount: -3000, created_at: T(4) }),
      ],
    })
    expect(s.lines.map(l => l.kind)).toEqual(['credit_issued', 'account_refund'])
    expect(s.lines[1]).toMatchObject({ delta: -3000, amount: 3000, balance: 0 })
    expect(s.balance).toBe(0)
  })

  it('is told apart from a charge by its source, not by its sign', () => {
    const s = build({
      credits: [
        charge({ id: 'c1', amount: -1200, created_at: T(4) }),
        refund({ id: 'c2', amount: -1200, created_at: T(5) }),
      ],
    })
    expect(s.lines.map(l => l.kind)).toEqual(['account_charge', 'account_refund'])
    expect(s.balance).toBe(-2400)
  })
})

// The summary block reads as one accounting identity, so its figures have to
// account over one set of bookings. They do not: `charged` and `paid` cover
// live bookings, and `openCredit` covers every credit the diver holds. A
// cancelled event's charge and payments leave together and the refund stays,
// which puts a credit on screen beside a Charged and a Paid that square to the
// penny — "22,450 / 22,450 / 5,000", which reads as a bug rather than as a
// cancellation. `fromCancelled` is the missing provenance.
describe('summary totals over a diver with a cancelled event', () => {
  // Marius Drop, 2026-08-27: three live bookings paid to the cent, two courses
  // whose events were called off with 2,500 paid on each.
  const bookings = [
    booking({ id: 'live-1', details: { total: 4300 } }),
    booking({ id: 'live-2', details: { total: 2950 } }),
    booking({ id: 'live-3', details: { total: 15200 } }),
    booking({ id: 'off-1', status: 'cancelled', cancelled_at: T(27), details: { total: 5440 } }),
    booking({ id: 'off-2', status: 'cancelled', cancelled_at: T(27), details: { total: 7240 } }),
  ]
  const payments = [
    payment({ id: 'p1', booking_id: 'live-1', amount: 4300 }),
    payment({ id: 'p2', booking_id: 'live-2', amount: 2950 }),
    payment({ id: 'p3', booking_id: 'live-3', amount: 15200 }),
    payment({ id: 'p4', booking_id: 'off-1', amount: 2500 }),
    payment({ id: 'p5', booking_id: 'off-2', amount: 2500 }),
  ]
  const credits = [
    credit({ id: 'c1', booking_id: 'off-1', amount: 2500, source: 'event_cancellation', created_at: T(28) }),
    credit({ id: 'c2', booking_id: 'off-2', amount: 2500, source: 'event_cancellation', created_at: T(28) }),
  ]
  const built = () => buildDiverStatement({
    bookings, payments, credits, amendmentsByBooking: new Map(),
  })

  it('closes at what the shop owes, and the identity still holds', () => {
    const s = built()
    expect(s.totals.charged).toBe(22450)
    expect(s.totals.paid).toBe(22450)
    expect(s.totals.openCredit).toBe(5000)
    expect(s.balance).toBe(5000)
    expect(s.balance).toBe(s.totals.paid - s.totals.charged + s.totals.openCredit)
  })

  it('names where the credit came from, so it is not money out of nowhere', () => {
    expect(built().totals.fromCancelled).toBe(5000)
  })

  it('stays quiet for a diver with nothing cancelled', () => {
    const s = buildDiverStatement({
      bookings: bookings.slice(0, 3),
      payments: payments.slice(0, 3),
      credits: [],
      amendmentsByBooking: new Map(),
    })
    expect(s.totals.fromCancelled).toBe(0)
    expect(s.balance).toBe(0)
  })

  it('counts only what the shop still holds, not a payment already refunded', () => {
    const s = buildDiverStatement({
      bookings,
      payments: [...payments, payment({ id: 'p6', booking_id: 'off-1', amount: 2500, status: 'refunded' })],
      credits: [credits[1]],
      amendmentsByBooking: new Map(),
    })
    // off-1's cash went back off-app, so only off-2's 2,500 became credit.
    expect(s.totals.fromCancelled).toBe(2500)
    expect(s.totals.openCredit).toBe(2500)
  })
})
