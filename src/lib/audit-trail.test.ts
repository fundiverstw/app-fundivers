import { describe, it, expect } from 'vitest'
import {
  paymentEntries,
  creditEntries,
  amendmentEntries,
  auditLogEntries,
  diffChangedColumns,
  mergeEntries,
  paymentsNetPaid,
  assembleDiverAuditTrail,
  signedDisplayAmount,
} from './audit-trail'
import type {
  AdminAuditLog,
  AppEvent,
  Booking,
  BookingAmendment,
  Credit,
  Payment,
  Profile,
} from '../types/database'

function payment(o: Partial<Payment>): Payment {
  return {
    id: 'p1',
    created_at: '2026-05-10T00:00:00.000Z',
    user_id: 'u1',
    booking_id: 'b1',
    amount: 1000,
    currency: 'TWD',
    status: 'paid',
    method: 'bank_transfer',
    note: null,
    recorded_by: 'admin1',
    ...o,
  }
}

function credit(o: Partial<Credit>): Credit {
  return {
    id: 'c1',
    created_at: '2026-05-11T00:00:00.000Z',
    user_id: 'u1',
    booking_id: 'b1',
    amount: 500,
    currency: 'TWD',
    reason: 'weather cancellation',
    status: 'open',
    created_by: 'admin1',
    settled_at: null,
    settled_note: null,
    ...o,
  }
}

function amendment(o: Partial<BookingAmendment>): BookingAmendment {
  return {
    id: 'a1',
    booking_id: 'b1',
    amount: 300,
    note: 'extra tank',
    created_by: 'admin1',
    created_at: '2026-05-12T00:00:00.000Z',
    ...o,
  }
}

function logRow(o: Partial<AdminAuditLog>): AdminAuditLog {
  return {
    id: 'l1',
    created_at: '2026-05-13T00:00:00.000Z',
    actor_id: 'admin1',
    action: 'update',
    target_table: 'bookings',
    target_id: 'b1',
    before: { status: 'pending' },
    after: { status: 'confirmed' },
    ...o,
  }
}

function booking(o: Partial<Booking>): Booking {
  return {
    id: 'b1',
    created_at: '2026-05-01T00:00:00.000Z',
    user_id: 'u1',
    status: 'confirmed',
    notes: null,
    details: { total: 4000, deposit: 1000 },
    refund_requested_at: null,
    group_id: null,
    payer_id: null,
    event_id: 'e1',
    ...o,
  } as Booking
}

const profile = { id: 'u1', name: 'Ada Diver', nickname: null } as Profile
const event = { id: 'e1', title: 'Green Island', currency: 'TWD' } as AppEvent

describe('paymentEntries', () => {
  it('maps status to kind and keeps raw amount', () => {
    const [paid, refunded, voided, pending] = paymentEntries([
      payment({ id: 'p1', status: 'paid' }),
      payment({ id: 'p2', status: 'refunded' }),
      payment({ id: 'p3', status: 'voided' }),
      payment({ id: 'p4', status: 'pending' }),
    ])
    expect(paid.kind).toBe('payment_paid')
    expect(refunded.kind).toBe('payment_refunded')
    expect(voided.kind).toBe('payment_voided')
    expect(pending.kind).toBe('payment_pending')
    expect(paid.amount).toBe(1000)
    expect(paid.method).toBe('bank_transfer')
    expect(paid.actorId).toBe('admin1')
  })
})

describe('creditEntries', () => {
  it('open credit emits one issued entry', () => {
    const entries = creditEntries([credit({ status: 'open' })])
    expect(entries).toHaveLength(1)
    expect(entries[0].kind).toBe('credit_issued')
    expect(entries[0].note).toBe('weather cancellation')
  })

  it('settled credit emits issued + settled entries at the right times', () => {
    const entries = creditEntries([credit({
      status: 'settled',
      settled_at: '2026-06-01T00:00:00.000Z',
      settled_note: 'paid back',
    })])
    expect(entries.map(e => e.kind)).toEqual(['credit_issued', 'credit_settled'])
    expect(entries[1].at).toBe('2026-06-01T00:00:00.000Z')
    expect(entries[1].note).toBe('paid back')
  })
})

describe('amendmentEntries', () => {
  it('carries the signed amount through', () => {
    const [e] = amendmentEntries([amendment({ amount: -250 })])
    expect(e.kind).toBe('amendment')
    expect(e.amount).toBe(-250)
    expect(e.bookingId).toBe('b1')
  })
})

describe('diffChangedColumns', () => {
  it('lists only the keys that changed, sorted', () => {
    expect(diffChangedColumns(
      { status: 'pending', notes: 'x', refund_requested_at: null },
      { status: 'confirmed', notes: 'x', refund_requested_at: '2026-05-13' },
    )).toEqual(['refund_requested_at', 'status'])
  })

  it('handles null before (insert-like)', () => {
    expect(diffChangedColumns(null, { a: 1 })).toEqual(['a'])
  })
})

describe('auditLogEntries', () => {
  it('turns a booking update into a booking_update with changed columns', () => {
    const [e] = auditLogEntries([logRow({})])
    expect(e.kind).toBe('booking_update')
    expect(e.bookingId).toBe('b1')
    expect(e.userId).toBeNull()
    expect(e.changed).toEqual(['status'])
  })

  it('routes a profile row to userId, not bookingId', () => {
    const [e] = auditLogEntries([logRow({ target_table: 'profiles', target_id: 'u1', action: 'update' })])
    expect(e.kind).toBe('profile_update')
    expect(e.userId).toBe('u1')
    expect(e.bookingId).toBeNull()
  })

  it('ignores unknown target tables', () => {
    expect(auditLogEntries([logRow({ target_table: 'duties' })])).toHaveLength(0)
  })
})

describe('mergeEntries', () => {
  it('sorts ascending by timestamp', () => {
    const merged = mergeEntries(
      amendmentEntries([amendment({ created_at: '2026-05-12T00:00:00.000Z' })]),
      paymentEntries([payment({ created_at: '2026-05-10T00:00:00.000Z' })]),
    )
    expect(merged.map(e => e.at)).toEqual([
      '2026-05-10T00:00:00.000Z',
      '2026-05-12T00:00:00.000Z',
    ])
  })

  it('breaks ties deterministically by source order', () => {
    const at = '2026-05-10T00:00:00.000Z'
    const merged = mergeEntries(
      amendmentEntries([amendment({ created_at: at })]),
      paymentEntries([payment({ created_at: at })]),
    )
    expect(merged.map(e => e.source)).toEqual(['payment', 'amendment'])
  })
})

describe('paymentsNetPaid', () => {
  it('adds paid, subtracts refunded, ignores voided/pending', () => {
    expect(paymentsNetPaid([
      payment({ status: 'paid', amount: 1000 }),
      payment({ status: 'refunded', amount: 400 }),
      payment({ status: 'voided', amount: 999 }),
      payment({ status: 'pending', amount: 999 }),
    ])).toBe(600)
  })
})

describe('assembleDiverAuditTrail', () => {
  const base = () => ({
    profile,
    bookings: [booking({})],
    events: new Map([['e1', event]]),
    payments: [payment({ status: 'paid', amount: 1000 })],
    credits: [] as Credit[],
    amendmentsByBooking: new Map<string, BookingAmendment[]>(),
    auditLog: [] as AdminAuditLog[],
  })

  it('reconciles owed/paid/balance for one registration', () => {
    const trail = assembleDiverAuditTrail(base())
    const reg = trail.registrations[0]
    expect(reg.owedBase).toBe(4000)
    expect(reg.paid).toBe(1000)
    expect(reg.owed).toBe(4000)
    expect(reg.balance.state).toBe('due')
    expect(reg.balance.amount).toBe(3000)
  })

  it('folds amendments into owed', () => {
    const input = base()
    input.amendmentsByBooking = new Map([['b1', [amendment({ amount: 500 })]]])
    const reg = assembleDiverAuditTrail(input).registrations[0]
    expect(reg.amendmentsDelta).toBe(500)
    expect(reg.owed).toBe(4500)
    expect(reg.balance.amount).toBe(3500)
  })

  it('a cancelled registration shows no balance owed', () => {
    const input = base()
    input.bookings = [booking({ status: 'cancelled' })]
    // Paid 1000 of a 4000 booking, then cancelled — the frozen 3000 "due" must
    // not surface as owed; a cancelled booking settles to zero.
    const reg = assembleDiverAuditTrail(input).registrations[0]
    expect(reg.balance.state).toBe('settled')
    expect(reg.balance.amount).toBe(0)
  })

  it('open credit tied to the booking offsets the balance', () => {
    const input = base()
    input.credits = [credit({ booking_id: 'b1', amount: 3000, status: 'open' })]
    const reg = assembleDiverAuditTrail(input).registrations[0]
    expect(reg.openCredit).toBe(3000)
    expect(reg.balance.state).toBe('settled')
  })

  it('separates general (booking-less) credits', () => {
    const input = base()
    input.credits = [credit({ id: 'g1', booking_id: null, amount: 800, status: 'open' })]
    const trail = assembleDiverAuditTrail(input)
    expect(trail.generalCredits.map(c => c.id)).toEqual(['g1'])
  })

  it('computes totals across sources', () => {
    const input = base()
    input.payments = [
      payment({ id: 'p1', status: 'paid', amount: 1000 }),
      payment({ id: 'p2', status: 'refunded', amount: 200 }),
    ]
    input.credits = [credit({ amount: 500 })]
    input.amendmentsByBooking = new Map([['b1', [amendment({ amount: 300 }), amendment({ id: 'a2', amount: -100 })]]])
    const { totals } = assembleDiverAuditTrail(input)
    expect(totals).toEqual({ paid: 1000, refunded: 200, credited: 500, adjusted: 200 })
  })

  it('builds a flat feed of every event, oldest first', () => {
    const input = base()
    input.credits = [credit({ created_at: '2026-05-11T00:00:00.000Z' })]
    input.amendmentsByBooking = new Map([['b1', [amendment({ created_at: '2026-05-12T00:00:00.000Z' })]]])
    const { allEntries } = assembleDiverAuditTrail(input)
    expect(allEntries.map(e => e.source)).toEqual(['payment', 'credit', 'amendment'])
  })
})

describe('signedDisplayAmount', () => {
  it('shows a payment as reducing balance owed', () => {
    const [e] = paymentEntries([payment({ status: 'paid', amount: 1000 })])
    expect(signedDisplayAmount(e)).toBe(-1000)
  })

  it('shows a refund as money going back to the diver', () => {
    const [e] = paymentEntries([payment({ status: 'refunded', amount: 400 })])
    expect(signedDisplayAmount(e)).toBe(400)
  })

  it('passes an amendment sign through', () => {
    const [e] = amendmentEntries([amendment({ amount: -250 })])
    expect(signedDisplayAmount(e)).toBe(-250)
  })

  it('is null for field-change log rows', () => {
    const [e] = auditLogEntries([logRow({})])
    expect(signedDisplayAmount(e)).toBeNull()
  })
})
