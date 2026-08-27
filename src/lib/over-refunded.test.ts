import { describe, it, expect } from 'vitest'
import { selectOverRefunded } from './over-refunded'
import type { Booking, Credit, Payment } from '../types/database'

type B = Parameters<typeof selectOverRefunded>[0]['bookings'][number]
type P = Parameters<typeof selectOverRefunded>[0]['payments'][number]
type C = Parameters<typeof selectOverRefunded>[0]['credits'][number]

const booking = (id: string, user_id = 'u1'): B =>
  ({ id, user_id, event_id: `ev-${id}` }) as Booking

const payment = (booking_id: string, amount: number, status = 'paid'): P =>
  ({ booking_id, amount, status }) as Payment

const credit = (booking_id: string | null, amount: number, source = 'event_cancellation'): C =>
  ({ booking_id, amount, source }) as Credit

function run(over: Partial<Parameters<typeof selectOverRefunded>[0]> = {}) {
  return selectOverRefunded({
    bookings: [booking('b1')],
    payments: [],
    credits: [],
    eventTitles: new Map([['ev-b1', 'Green Island']]),
    profiles: [{ id: 'u1', name: 'Ada Lovelace', nickname: null }],
    eventFallback: '(event)',
    diverFallback: '(diver)',
    ...over,
  })
}

describe('selectOverRefunded', () => {
  it('says nothing when the refund is covered by what was paid', () => {
    expect(run({ payments: [payment('b1', 3000)], credits: [credit('b1', 3000)] })).toEqual([])
  })

  // The case that prompted this: the payment was voided, so the ledger says
  // the booking received nothing, and a refund credit is still sitting on it.
  it('flags a refund on a booking whose payment was voided', () => {
    const [row] = run({
      payments: [payment('b1', 6400, 'voided')],
      credits: [credit('b1', 6400)],
    })
    expect(row).toMatchObject({ netPaid: 0, returned: 6400, excess: 6400, diverName: 'Ada Lovelace' })
  })

  it('flags a booking credited twice for the same cancellation', () => {
    const [row] = run({
      payments: [payment('b1', 5900)],
      credits: [credit('b1', 5900), credit('b1', 4400)],
    })
    expect(row.excess).toBe(4400)
  })

  // A goodwill award is not a claim about what was paid. Counting it would
  // flag every act of generosity the shop has ever performed.
  it('ignores credit that never claimed to be a refund', () => {
    expect(run({
      payments: [payment('b1', 200)],
      credits: [credit('b1', 500, 'manual'), credit('b1', 300, 'carry_forward')],
    })).toEqual([])
  })

  it('counts a return credit whatever its status, because spent is worse than open', () => {
    const [row] = run({
      payments: [],
      credits: [credit('b1', 2000, 'booking_cancellation_return')],
    })
    expect(row.excess).toBe(2000)
  })

  it('nets a refunded payment out of what the booking received', () => {
    const [row] = run({
      payments: [payment('b1', 3000), payment('b1', 3000, 'refunded')],
      credits: [credit('b1', 3000)],
    })
    expect(row).toMatchObject({ netPaid: 0, excess: 3000 })
  })

  it('leaves general credit alone — it belongs to no booking', () => {
    expect(run({ credits: [credit(null, 9000)] })).toEqual([])
  })

  it('puts the largest hole first, since that is the one to answer for', () => {
    const rows = selectOverRefunded({
      bookings: [booking('b1'), booking('b2'), booking('b3')],
      payments: [payment('b2', 1000)],
      credits: [credit('b1', 500), credit('b2', 9000), credit('b3', 2000)],
      eventTitles: new Map(),
      profiles: [],
      eventFallback: '(event)',
      diverFallback: '(diver)',
    })
    expect(rows.map(r => r.excess)).toEqual([8000, 2000, 500])
    expect(rows[0].eventTitle).toBe('(event)')
    expect(rows[0].diverName).toBe('(diver)')
  })
})
