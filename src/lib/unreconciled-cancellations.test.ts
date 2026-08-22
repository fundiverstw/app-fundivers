import { describe, it, expect } from 'vitest'
import { selectUnreconciled } from './unreconciled-cancellations'
import { siteConfig } from '../config/site'
import type { AppEvent, Booking, Credit, Payment } from '../types/database'

// Money on a cancelled booking is invisible everywhere else: bookingBalance
// short-circuits a cancelled booking to "settled", diverCreditBalance drops it
// from the active set, and the refund queue lists only non-cancelled bookings.
// This selector is the only thing that sees it, so it has to be exact about
// which credits count as "already given back".

const LABELS = { eventFallback: 'Event', diverFallback: 'Diver' }

const events = new Map<string, AppEvent>([
  ['ev1', { id: 'ev1', title: 'Green Island Trip' } as AppEvent],
])
const profiles = [{ id: 'd1', name: 'Alice Diver', nickname: null }]

type B = Pick<Booking, 'id' | 'user_id' | 'event_id' | 'status'>
type P = Pick<Payment, 'booking_id' | 'amount' | 'status'>
type C = Pick<Credit, 'booking_id' | 'source'>

const booking = (over: Partial<B> = {}): B =>
  ({ id: 'b1', user_id: 'd1', event_id: 'ev1', status: 'cancelled', ...over }) as B

function run(opts: { bookings?: B[]; payments?: P[]; credits?: C[] } = {}) {
  return selectUnreconciled({
    bookings: opts.bookings ?? [booking()],
    payments: opts.payments ?? [{ booking_id: 'b1', amount: 3000, status: 'paid' } as P],
    credits: opts.credits ?? [],
    events, profiles, ...LABELS,
  })
}

describe('selectUnreconciled', () => {
  it('surfaces a cancelled booking that still holds money', () => {
    const rows = run()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      bookingId: 'b1', userId: 'd1', diverName: 'Alice Diver',
      eventTitle: 'Green Island Trip', amount: 3000,
      currency: siteConfig.locale.currency,
    })
  })

  it('ignores bookings that are not cancelled', () => {
    expect(run({ bookings: [booking({ status: 'confirmed' })] })).toHaveLength(0)
  })

  it('ignores a cancelled booking nobody paid against', () => {
    expect(run({ payments: [] })).toHaveLength(0)
  })

  it('nets refunds out, so a fully refunded booking is settled', () => {
    expect(run({
      payments: [
        { booking_id: 'b1', amount: 3000, status: 'paid' },
        { booking_id: 'b1', amount: 3000, status: 'refunded' },
      ] as P[],
    })).toHaveLength(0)
  })

  it('reports only the unrefunded remainder of a partial refund', () => {
    const rows = run({
      payments: [
        { booking_id: 'b1', amount: 3000, status: 'paid' },
        { booking_id: 'b1', amount: 1000, status: 'refunded' },
      ] as P[],
    })
    expect(rows[0].amount).toBe(2000)
  })

  it('ignores voided rows', () => {
    expect(run({ payments: [{ booking_id: 'b1', amount: 3000, status: 'voided' }] as P[] })).toHaveLength(0)
  })

  it('clears once a credit says the money was returned', () => {
    for (const source of ['event_cancellation', 'booking_cancellation_return'] as const) {
      expect(run({ credits: [{ booking_id: 'b1', source }] as C[] })).toHaveLength(0)
    }
  })

  it('does NOT clear for an unrelated credit tied to the same booking', () => {
    // A goodwill award or a carry-forward remainder is other money entirely.
    // Treating it as "already returned" is exactly the bug that let a booking
    // with a 200 award swallow a 3000 refund.
    for (const source of ['manual', 'carry_forward'] as const) {
      expect(run({ credits: [{ booking_id: 'b1', source }] as C[] })).toHaveLength(1)
    }
  })

  it('ignores a returned credit that belongs to a different booking', () => {
    expect(run({ credits: [{ booking_id: 'b-other', source: 'event_cancellation' }] as C[] })).toHaveLength(1)
  })

  it('falls back to labels for an unknown event or diver', () => {
    const rows = selectUnreconciled({
      bookings: [booking({ id: 'b2', user_id: 'ghost', event_id: 'gone' })],
      payments: [{ booking_id: 'b2', amount: 500, status: 'paid' } as P],
      credits: [], events, profiles, ...LABELS,
    })
    expect(rows[0]).toMatchObject({ diverName: 'Diver', eventTitle: 'Event' })
  })

  it('sorts biggest first, so the costliest mistake is at the top', () => {
    const rows = selectUnreconciled({
      bookings: [booking({ id: 'small' }), booking({ id: 'big' })],
      payments: [
        { booking_id: 'small', amount: 400, status: 'paid' },
        { booking_id: 'big', amount: 9000, status: 'paid' },
      ] as P[],
      credits: [], events, profiles, ...LABELS,
    })
    expect(rows.map(r => r.bookingId)).toEqual(['big', 'small'])
  })
})
