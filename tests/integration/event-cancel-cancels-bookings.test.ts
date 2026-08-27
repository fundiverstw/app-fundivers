// Integration tests for trg_events_cancel_bookings — cancelling an event
// cancels the registrations on it, and restoring it puts them back.
//
// The bug this locks out: a shop-side cancellation used to set
// events.cancelled_at and stop, leaving every booking 'confirmed'. Its frozen
// details.total stayed alive as a debt on an event that would never happen,
// and the cancellation credit — tied to that booking — was netted straight
// back into the phantom debt. A diver with two cancelled courses and 5,000 of
// refund read as owing the shop 2,680 with nothing spendable.
//
// What we lock in:
//   1. Cancelling the event cancels its live bookings and remembers what they
//      were, so the balance dies with the event.
//   2. The refund is the whole of what was paid — the cancel-by date and a
//      non-refundable deposit are the diver's problem when the DIVER cancels,
//      and nobody's when the shop calls the event off.
//   3. A diver who had already pulled out is untouched, and is not paid twice.
//   4. Restoring the event returns each booking to its own prior status,
//      waitlisted included, and takes the refund back.
//   5. Credit cannot be spent into a booking on a cancelled event.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
const cleanupUsers: string[] = []
const cleanupDives: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  cleanupUsers.push(adminUser.id)
})

afterAll(async () => {
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
  for (const id of cleanupDives) await deleteTestDive(admin, id)
})

async function freshDiver(): Promise<TestUser> {
  const d = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(d.id)
  return d
}

async function freshDive(): Promise<string> {
  const id = await createTestDive(admin)
  cleanupDives.push(id)
  return id
}

async function makeBooking(
  userId: string, eventId: string, total: number,
  status: 'confirmed' | 'pending' | 'waitlisted' | 'cancelled' = 'confirmed',
  deposit = 0,
): Promise<string> {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: eventId, status, details: { total, deposit },
  } as never).select('id').single()
  if (error) throw new Error(`makeBooking failed: ${error.message}`)
  return (data as { id: string }).id
}

async function pay(userId: string, bookingId: string, amount: number, method = 'bank_transfer') {
  const { error } = await admin.from('payments').insert({
    user_id: userId, booking_id: bookingId, amount, status: 'paid', method,
    note: 'test payment', reference: method === 'account_credit' ? null : `R-${amount}`,
  })
  if (error) throw new Error(`pay failed: ${error.message}`)
}

async function setCancelled(eventId: string, at: string | null) {
  const { error } = await admin.from('events').update({ cancelled_at: at } as never).eq('id', eventId)
  if (error) throw new Error(`setCancelled failed: ${error.message}`)
}

async function bookingRow(id: string) {
  const { data, error } = await admin.from('bookings')
    .select('status, status_before_event_cancel, cancelled_at').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data as { status: string; status_before_event_cancel: string | null; cancelled_at: string | null }
}

async function creditsFor(bookingId: string) {
  const { data, error } = await admin.from('credits')
    .select('amount, status, source, reason').eq('booking_id', bookingId)
  if (error) throw new Error(error.message)
  return (data ?? []) as Array<{ amount: number; status: string; source: string; reason: string }>
}

describe('cancelling an event cancels its bookings', () => {
  it('cancels the live ones, remembers what they were, and leaves the rest alone', async () => {
    const [a, b, c] = [await freshDiver(), await freshDiver(), await freshDiver()]
    const dive = await freshDive()
    const confirmed = await makeBooking(a.id, dive, 3000)
    const waitlisted = await makeBooking(b.id, dive, 3000, 'waitlisted')
    const alreadyGone = await makeBooking(c.id, dive, 3000, 'cancelled')

    await setCancelled(dive, new Date().toISOString())

    expect(await bookingRow(confirmed)).toMatchObject({
      status: 'cancelled', status_before_event_cancel: 'confirmed',
    })
    expect(await bookingRow(waitlisted)).toMatchObject({
      status: 'cancelled', status_before_event_cancel: 'waitlisted',
    })
    // Cancelled before the event was: not the event's doing, so not the
    // event's to restore either.
    expect(await bookingRow(alreadyGone)).toMatchObject({
      status: 'cancelled', status_before_event_cancel: null,
    })
  })

  it('stamps the booking with the event cancellation time, not the write time', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const booking = await makeBooking(diver.id, dive, 3000)
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString()

    await setCancelled(dive, at)

    const row = await bookingRow(booking)
    expect(new Date(row.cancelled_at!).getTime()).toBe(new Date(at).getTime())
  })

  it('refunds everything paid, ignoring the cancel-by date the diver never used', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const booking = await makeBooking(diver.id, dive, 5000)
    await pay(diver.id, booking, 2500)

    await setCancelled(dive, new Date().toISOString())

    const credits = await creditsFor(booking)
    expect(credits).toHaveLength(1)
    expect(Number(credits[0].amount)).toBe(2500)
    expect(credits[0].status).toBe('open')
    // Provenance survives the consolidation: the shop called this one off.
    expect(credits[0].source).toBe('event_cancellation')
    expect(credits[0].reason).toContain('cancelled event')
  })

  it('does not withhold a non-refundable deposit when the shop is the one cancelling', async () => {
    const { data: policy, error } = await admin.from('cancellation_policies').insert({
      title: `test-nonrefundable-${crypto.randomUUID().slice(0, 8)}`,
      deposit_refundable: false,
    } as never).select('id').single()
    if (error) throw new Error(error.message)
    const policyId = (policy as { id: string }).id

    const diver = await freshDiver()
    const dive = await freshDive()
    await admin.from('events').update({ cancel_policy: policyId } as never).eq('id', dive)
    const booking = await makeBooking(diver.id, dive, 5000, 'confirmed', 2000)
    await pay(diver.id, booking, 5000)

    await setCancelled(dive, new Date().toISOString())

    const credits = await creditsFor(booking)
    expect(credits).toHaveLength(1)
    expect(Number(credits[0].amount)).toBe(5000)
    expect(credits[0].reason).not.toContain('deposit withheld')

    await admin.from('cancellation_policies').delete().eq('id', policyId)
  })

  it('pays nothing twice when a booking already carries its refund', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const booking = await makeBooking(diver.id, dive, 4000)
    await pay(diver.id, booking, 4000)
    await admin.from('credits').insert({
      user_id: diver.id, booking_id: booking, amount: 4000, currency: 'TWD',
      reason: 'already refunded by hand', status: 'open', source: 'event_cancellation',
    } as never)

    await setCancelled(dive, new Date().toISOString())

    const credits = await creditsFor(booking)
    expect(credits).toHaveLength(1)
    expect(Number(credits[0].amount)).toBe(4000)
  })

  it('refuses to spend credit into a booking on a cancelled event', async () => {
    const diver = await freshDiver()
    const [live, dead] = [await freshDive(), await freshDive()]
    const spendable = await makeBooking(diver.id, live, 6000)
    const target = await makeBooking(diver.id, dead, 6000)
    await pay(diver.id, target, 1000)
    await admin.from('credits').insert({
      user_id: diver.id, booking_id: spendable, amount: 3000, currency: 'TWD',
      reason: 'test credit', status: 'open', source: 'manual',
    } as never)

    await setCancelled(dead, new Date().toISOString())

    const diverApi = await userClient(diver.email, diver.password)
    const { error } = await diverApi.rpc('apply_credit_to_booking', {
      p_booking_id: target, p_amount: 3000,
    })
    expect(error?.message ?? '').toContain('cancelled')
  })
})

describe('restoring an event puts its bookings back', () => {
  it('returns each booking to its own prior status and takes the refund back', async () => {
    const [a, b] = [await freshDiver(), await freshDiver()]
    const dive = await freshDive()
    const confirmed = await makeBooking(a.id, dive, 3000)
    const waitlisted = await makeBooking(b.id, dive, 3000, 'waitlisted')
    await pay(a.id, confirmed, 3000)

    await setCancelled(dive, new Date().toISOString())
    expect((await creditsFor(confirmed))[0].status).toBe('open')

    await setCancelled(dive, null)

    expect(await bookingRow(confirmed)).toMatchObject({
      status: 'confirmed', status_before_event_cancel: null, cancelled_at: null,
    })
    expect(await bookingRow(waitlisted)).toMatchObject({
      status: 'waitlisted', status_before_event_cancel: null,
    })
    // The refund is taken back: the event is on again, so the money is once
    // more paying for it. Without this the diver kept both.
    const credits = await creditsFor(confirmed)
    expect(credits).toHaveLength(1)
    expect(credits[0].status).toBe('settled')
    expect(credits[0].source).toBe('return_reclaimed')
  })

  it('works when an admin cancels through their own session, not the service key', async () => {
    // The real path. The trigger is SECURITY DEFINER so it writes past RLS,
    // but nothing proves that from a service-role client, which bypasses RLS
    // before the trigger ever runs.
    const diver = await freshDiver()
    const dive = await freshDive()
    const booking = await makeBooking(diver.id, dive, 3000)
    await pay(diver.id, booking, 3000)

    const adminApi = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminApi.from('events')
      .update({ cancelled_at: new Date().toISOString() } as never).eq('id', dive)
    expect(error).toBeNull()

    expect(await bookingRow(booking)).toMatchObject({
      status: 'cancelled', status_before_event_cancel: 'confirmed',
    })
    const credits = await creditsFor(booking)
    expect(credits).toHaveLength(1)
    expect(Number(credits[0].amount)).toBe(3000)
  })

  it('leaves a diver who cancelled on their own still cancelled', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const booking = await makeBooking(diver.id, dive, 3000, 'cancelled')

    await setCancelled(dive, new Date().toISOString())
    await setCancelled(dive, null)

    expect(await bookingRow(booking)).toMatchObject({
      status: 'cancelled', status_before_event_cancel: null,
    })
  })
})
