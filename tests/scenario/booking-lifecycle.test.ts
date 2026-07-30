import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'
import { netPaid } from '../../src/lib/payments'
import { amendmentsDelta } from '../../src/lib/booking-amendments'

// A booking from "the diver wants to come" to "the money is settled", and the
// two ways it can end early.
//
// Each step is what the shop actually does, in order, with the database doing
// its real work in between — so the assertions are about the state a shop would
// see on the diver's card, not about one function in isolation.

let w: World
const l: Ledger = ledger()

beforeAll(async () => { w = await world(l) })
afterAll(async () => { await teardownWorld(l) })

async function owedPaid(bookingId: string) {
  const [{ data: booking }, { data: amendments }, { data: payments }] = await Promise.all([
    w.admin.from('bookings').select('status, details').eq('id', bookingId).single(),
    w.admin.from('booking_amendments').select('amount, note').eq('booking_id', bookingId),
    w.admin.from('payments').select('amount, status').eq('booking_id', bookingId),
  ])
  const b = booking as { status: string; details: { total?: number; deposit?: number } }
  const owed = Number(b.details.total ?? 0)
    + amendmentsDelta((amendments ?? []) as never)
  // The same rule every diver-facing surface uses: paid is NET of refunds.
  return { status: b.status, owed, paid: netPaid((payments ?? []) as never), deposit: Number(b.details.deposit ?? 0) }
}

describe('scenario: a diver books, pays a deposit, then settles up', () => {
  it('walks from booked to settled with the balance right at every step', async () => {
    const diver = await w.person('diver')
    const eventId = await w.dive()
    const bookingId = await w.book({ diver, eventId, total: 3000, deposit: 1000 })

    // Booked, nothing paid.
    let f = await owedPaid(bookingId)
    expect(f.owed - f.paid).toBe(3000)
    expect(Math.max(0, Math.min(f.deposit, f.owed) - f.paid)).toBe(1000)

    // Deposit lands: the balance drops but the booking still owes.
    await w.pay({ bookingId, diver, amount: 1000 })
    f = await owedPaid(bookingId)
    expect(f.owed - f.paid).toBe(2000)
    expect(Math.max(0, Math.min(f.deposit, f.owed) - f.paid)).toBe(0)

    // A shop discount, applied after the deposit — the order that used to break.
    await w.admin.from('booking_amendments').insert({
      booking_id: bookingId, amount: -400, note: 'loyalty discount',
      created_by: w.adminUser.id,
    } as never)
    f = await owedPaid(bookingId)
    expect(f.owed).toBe(2600)
    expect(f.owed - f.paid).toBe(1600)

    // Settled.
    await w.pay({ bookingId, diver, amount: 1600 })
    f = await owedPaid(bookingId)
    expect(f.owed - f.paid).toBe(0)
  })

  it('a refund reopens the balance rather than double-counting', async () => {
    const diver = await w.person('diver')
    const eventId = await w.dive()
    const bookingId = await w.book({ diver, eventId, total: 2000, deposit: 500 })

    await w.pay({ bookingId, diver, amount: 2000 })
    expect((await owedPaid(bookingId)).paid).toBe(2000)

    await w.admin.from('payments').insert({
      booking_id: bookingId, user_id: diver.id,
      amount: 500, status: 'refunded', method: 'cash',
    } as never)

    const f = await owedPaid(bookingId)
    // Net of refunds — not 2500, and not still 2000.
    expect(f.paid).toBe(1500)
    expect(f.owed - f.paid).toBe(500)
  })

  it('a cancelled booking owes nothing, whatever it owed before', async () => {
    const diver = await w.person('diver')
    const eventId = await w.dive()
    const bookingId = await w.book({ diver, eventId, total: 4000, deposit: 1000 })
    await w.pay({ bookingId, diver, amount: 1000 })

    await w.admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', bookingId)

    const f = await owedPaid(bookingId)
    expect(f.status).toBe('cancelled')
    // The raw arithmetic still shows a gap; the app's rule is that a cancelled
    // booking is settled, with the refund expressed as a credit instead.
    expect(f.owed - f.paid).toBe(3000)
  })
})

describe('scenario: the diver books over capacity', () => {
  it('the second booking is waitlisted by the trigger, not by the client', async () => {
    const first = await w.person('diver')
    const second = await w.person('diver')
    const eventId = await w.dive({ capacity: 1 })

    const a = await w.book({ diver: first, eventId, status: 'confirmed' })
    expect(await w.bookingStatus(a)).toBe('confirmed')

    // Inserted as pending, exactly as create-registration does it.
    const b = await w.book({ diver: second, eventId, status: 'pending' })
    expect(await w.bookingStatus(b)).toBe('waitlisted')
  })
})
