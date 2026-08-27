import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'

// The shop calls off a dive people have paid for, and later calls off the rest
// of a recurring batch.
//
// Cancelling is never one write: the event is marked, the registrants are told,
// and each of them is credited what they paid. The bugs live between those
// three, so the scenario asserts the end state a diver would see — money back as
// credit, and a bookable event they can spend it on.

let w: World
const l: Ledger = ledger()

beforeAll(async () => { w = await world(l) })
afterAll(async () => { await teardownWorld(l) })

describe('scenario: a paid-up dive is cancelled', () => {
  it('leaves each diver a credit for exactly what they had paid', async () => {
    const ada = await w.person('diver')
    const grace = await w.person('diver')
    const eventId = await w.dive()

    const adaBooking = await w.book({ diver: ada, eventId, total: 3000, deposit: 1000 })
    const graceBooking = await w.book({ diver: grace, eventId, total: 3000, deposit: 1000 })
    await w.pay({ bookingId: adaBooking, diver: ada, amount: 3000 })
    await w.pay({ bookingId: graceBooking, diver: grace, amount: 1000 })

    // One write. Marking the event cancels the registrations under it, and
    // cancelling a registration is already what refunds it.
    await w.cancelEvent(eventId)

    // Each diver is owed back what they actually paid — not the ticket price.
    const adaCredits = await w.creditsOf(ada)
    expect(adaCredits.map(c => Number(c.amount))).toEqual([3000])
    const graceCredits = await w.creditsOf(grace)
    expect(graceCredits.map(c => Number(c.amount))).toEqual([1000])
    expect(graceCredits[0].status).toBe('open')

    // Neither is left owing the balance of a dive that will not happen: Grace
    // paid 1,000 of 3,000 and owes nothing further.
    expect(await w.bookingStatus(adaBooking)).toBe('cancelled')
    expect(await w.bookingStatus(graceBooking)).toBe('cancelled')
  })

  it("a diver's credit spends against a different dive, and cannot be spent twice", async () => {
    const diver = await w.person('diver')
    const cancelledEvent = await w.dive()
    const nextEvent = await w.dive({}, 21)

    const oldBooking = await w.book({ diver, eventId: cancelledEvent, total: 2000, deposit: 500 })
    await w.pay({ bookingId: oldBooking, diver, amount: 2000 })
    // The cancellation issues the credit itself, tied to the dead booking —
    // which is no obstacle to spending it somewhere else.
    await w.cancelEvent(cancelledEvent)

    const newBooking = await w.book({ diver, eventId: nextEvent, total: 3000, deposit: 1000 })
    const db = await w.as(diver)

    const applied = await db.rpc('apply_credit_to_booking', {
      p_booking_id: newBooking, p_amount: 2000,
    })
    expect(applied.error).toBeNull()
    expect(Number(applied.data)).toBe(2000)

    // Spending it again must fail — the pool is empty now.
    const again = await db.rpc('apply_credit_to_booking', {
      p_booking_id: newBooking, p_amount: 2000,
    })
    const secondAmount = again.error ? 0 : Number(again.data)
    expect(secondAmount).toBe(0)
  })

  it('refuses to spend credit on a cancelled booking', async () => {
    const diver = await w.person('diver')
    const eventId = await w.dive()
    const bookingId = await w.book({ diver, eventId, total: 2000, deposit: 500 })
    await w.admin.from('credits').insert({
      user_id: diver.id, booking_id: null, amount: 1000, status: 'open',
      reason: 'goodwill', created_by: w.adminUser.id,
    } as never)
    await w.admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', bookingId)

    const db = await w.as(diver)
    const { data, error } = await db.rpc('apply_credit_to_booking', {
      p_booking_id: bookingId, p_amount: 1000,
    })
    // Either refused outright or a no-op — what matters is that nothing moved.
    expect(error ? 0 : Number(data)).toBe(0)
  })
})

describe('scenario: the shop calls off the rest of a recurring batch', () => {
  it('cancels only the later occurrences, leaving the booked one standing', async () => {
    const diver = await w.person('diver')
    const { seriesId, eventIds } = await w.series({ count: 4 })

    // A diver books the second occurrence; the shop then calls off everything
    // after it.
    const bookingId = await w.book({ diver, eventId: eventIds[1], total: 3000, deposit: 1000 })
    await w.pay({ bookingId, diver, amount: 3000 })

    for (const id of eventIds.slice(2)) await w.cancelEvent(id)

    const { data: rows } = await w.admin.from('events')
      .select('id, cancelled_at').eq('series_id', seriesId).order('start_date')
    const cancelled = (rows ?? []).map(r => !!(r as { cancelled_at: string | null }).cancelled_at)
    expect(cancelled).toEqual([false, false, true, true])

    // The booked occurrence is untouched, and so is the booking on it.
    expect(await w.bookingStatus(bookingId)).toBe('confirmed')
  })

  it('deleting the series leaves every occurrence and booking intact', async () => {
    const diver = await w.person('diver')
    const { seriesId, eventIds } = await w.series({ count: 3 })
    const bookingId = await w.book({ diver, eventId: eventIds[0] })

    await w.admin.from('event_series').delete().eq('id', seriesId)

    const { data: rows } = await w.admin.from('events').select('id, series_id').in('id', eventIds)
    expect((rows ?? []).length).toBe(3)
    expect((rows ?? []).every(r => (r as { series_id: string | null }).series_id === null)).toBe(true)
    expect(await w.bookingStatus(bookingId)).toBe('confirmed')
  })

  it('every occurrence carries its own dates, not the template\'s', async () => {
    const { eventIds, dates } = await w.series({ count: 5 })
    const { data: rows } = await w.admin.from('events')
      .select('start_date').in('id', eventIds).order('start_date')
    expect((rows ?? []).map(r => (r as { start_date: string }).start_date)).toEqual(dates)
  })
})
