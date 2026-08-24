// Integration tests for trg_bookings_return_account_credit_on_cancel — the
// trigger that hands a diver's account credit back when their booking is
// cancelled. What we lock in:
//   1. Cancelling a booking paid with account credit issues a fresh open credit
//      for the amount consumed, tied to that booking.
//   2. Off-app methods (bank transfer, cash) are left alone — those refunds
//      move off-app when the refund request is approved.
//   3. It is idempotent against a credit that already RETURNED this booking's
//      money (source event_cancellation / booking_cancellation_return), so an
//      event cancellation followed by a booking cancellation never pays out
//      twice — but an unrelated credit tied to the same booking (a goodwill
//      award, a carry-forward remainder) does NOT suppress the return.
//   4. A prior reversal is netted out, so a partially refunded credit spend
//      only returns what is still outstanding.
//   5. The returned credit is spendable again — it lands back in the diver's
//      open balance rather than staying pinned to the dead booking.
//   6. Restoring the booking takes the refund BACK, because the credit is once
//      again applied to it. Without that, cancel → restore left the booking
//      carrying both the account-credit payment and the credit that refunded
//      it, and the diver's balance double-counted the same money.
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

async function makeBooking(userId: string, diveId: string, total: number): Promise<string> {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: diveId, status: 'confirmed', details: { total },
  } as never).select('id').single()
  if (error) throw new Error(`makeBooking failed: ${error.message}`)
  return (data as { id: string }).id
}

async function makePayment(
  userId: string, bookingId: string, amount: number,
  method: string, status: 'paid' | 'refunded' = 'paid',
): Promise<void> {
  const { error } = await admin.from('payments').insert({
    user_id: userId, booking_id: bookingId, amount, status, method, note: 'test payment',
    reference: method === 'account_credit' ? null : `R-${amount}`,
  })
  if (error) throw new Error(`makePayment failed: ${error.message}`)
}

async function cancel(bookingId: string): Promise<void> {
  const { error } = await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
  if (error) throw new Error(`cancel failed: ${error.message}`)
}

function creditsFor(bookingId: string) {
  return admin.from('credits').select('amount, status, reason, source').eq('booking_id', bookingId)
}

describe('account credit returned on booking cancellation', () => {
  it('issues an open credit for the account credit the booking consumed', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
    expect(Number(data![0].amount)).toBe(3000)
    expect(data![0].status).toBe('open')
    expect(data![0].reason).toContain('cancelled booking')
  })

  it('returns only the account credit portion of a mixed payment', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 5000)
    await makePayment(diver.id, bookingId, 2000, 'account_credit')
    await makePayment(diver.id, bookingId, 3000, 'bank_transfer')

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
    expect(Number(data![0].amount)).toBe(2000)
  })

  it('leaves a booking paid entirely off-app alone', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 4000)
    await makePayment(diver.id, bookingId, 4000, 'bank_transfer')

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data ?? []).toHaveLength(0)
  })

  it('nets out credit already reversed, returning only what is outstanding', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')
    await makePayment(diver.id, bookingId, 1000, 'account_credit', 'refunded')

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
    expect(Number(data![0].amount)).toBe(2000)
  })

  it('does not double-issue when the booking already had its money returned', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')
    // The event-cancellation credit, which already refunds the diver's full
    // net paid for this booking.
    const { error } = await admin.from('credits').insert({
      user_id: diver.id, booking_id: bookingId, amount: 3000,
      reason: 'Refund credit for cancelled event', created_by: adminUser.id,
      source: 'event_cancellation',
    } as never)
    if (error) throw new Error(error.message)

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
    expect(data![0].reason).toContain('cancelled event')
  })

  // The guard used to be "does this booking carry ANY credit?", so a small
  // unrelated award silently swallowed the whole refund the diver was owed.
  it('still returns the credit when the booking carries an unrelated award', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')
    const { error } = await admin.from('credits').insert({
      user_id: diver.id, booking_id: bookingId, amount: 200,
      reason: 'Goodwill: torn wetsuit', created_by: adminUser.id, source: 'manual',
    } as never)
    if (error) throw new Error(error.message)

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(2)
    const returned = data!.find(c => c.source === 'booking_cancellation_return')
    expect(returned).toBeDefined()
    expect(Number(returned!.amount)).toBe(3000)
  })

  it('stamps the credit it issues with its source', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 1200)
    await makePayment(diver.id, bookingId, 1200, 'account_credit')

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data![0].source).toBe('booking_cancellation_return')
  })

  // credits.currency defaulted to TWD while every other writer used the
  // configured currency, so a non-TWD deployment ended up with two currencies
  // in one table. The returned credit now inherits the payment's.
  it('denominates the returned credit in the currency of the money it returns', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 900)
    const { error: pErr } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: bookingId, amount: 900, status: 'paid',
      method: 'account_credit', currency: 'JPY', note: 'test payment',
    } as never)
    if (pErr) throw new Error(pErr.message)

    await cancel(bookingId)

    const { data } = await admin.from('credits')
      .select('currency').eq('booking_id', bookingId)
    expect(data![0].currency).toBe('JPY')
  })

  it('only fires on the transition into cancelled, not on later updates', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')

    await cancel(bookingId)
    // A second write that leaves the status cancelled must not re-issue. The
    // idempotency guard covers this too, but the WHEN clause is the first line
    // of defense and this pins it.
    const { error } = await admin.from('bookings')
      .update({ status: 'cancelled', notes: 'touched' }).eq('id', bookingId)
    if (error) throw new Error(error.message)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
  })

  it('makes the returned credit spendable on another booking', async () => {
    const diver = await freshDiver()
    const diveA = await freshDive()
    const diveB = await freshDive()
    const bookingA = await makeBooking(diver.id, diveA, 3000)
    await makePayment(diver.id, bookingA, 3000, 'account_credit')
    await cancel(bookingA)

    const bookingB = await makeBooking(diver.id, diveB, 3000)
    const diverApi = await userClient(diver.email, diver.password)
    const { data: applied, error } = await diverApi.rpc('apply_credit_to_booking', {
      p_booking_id: bookingB, p_amount: 3000,
    })
    expect(error).toBeNull()
    expect(Number(applied)).toBe(3000)
  })
})


// The mirror of the trigger above. A booking that goes cancelled → confirmed
// has the credit applied to it again, so the refund the cancellation issued has
// to come back. Production hit this: a booking cancelled on Aug 20 and restored
// on Aug 22 read "Owed 3,100 / Paid 6,700 / Balance 7,200 credit" when the true
// figure was 3,600.
describe('returned credit is reclaimed when the booking is restored', () => {
  async function restore(bookingId: string, status = 'confirmed'): Promise<void> {
    const { error } = await admin.from('bookings').update({ status }).eq('id', bookingId)
    if (error) throw new Error(`restore failed: ${error.message}`)
  }

  function paymentsFor(bookingId: string) {
    return admin.from('payments').select('amount, status, method').eq('booking_id', bookingId)
  }

  it('settles the returned credit, leaving the booking paid as it was', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')

    await cancel(bookingId)
    const afterCancel = await creditsFor(bookingId)
    expect(afterCancel.data).toHaveLength(1)
    expect(afterCancel.data![0].status).toBe('open')

    await restore(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('settled')

    // The booking still shows its 3,000 account-credit payment and nothing
    // offsetting it — exactly where it stood before the cancellation.
    const pays = await paymentsFor(bookingId)
    expect(pays.data).toHaveLength(1)
    expect(pays.data![0].status).toBe('paid')
  })

  it('reclaims nothing it did not hand back', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'bank_transfer')
    // An unrelated goodwill award tied to the same booking.
    const { error } = await admin.from('credits').insert({
      user_id: diver.id, booking_id: bookingId, amount: 400,
      reason: 'Goodwill', created_by: adminUser.id, source: 'manual',
    } as never)
    if (error) throw new Error(error.message)

    await cancel(bookingId)
    await restore(bookingId)

    // Off-app money was never returned, so there is nothing to reclaim and the
    // goodwill credit is untouched.
    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
    expect(data![0].status).toBe('open')
    expect(Number(data![0].amount)).toBe(400)
  })

  // Reclaiming has to retire the refund, not just settle it. While it still
  // read as 'booking_cancellation_return' the two triggers disagreed: the next
  // cancellation skipped issuing (it looked already refunded) and the next
  // restore reclaimed the same money a second time, inventing a refund payment
  // out of nothing.
  it('survives a second cancel and restore without inventing money', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')

    await cancel(bookingId)
    await restore(bookingId)
    await cancel(bookingId)

    // The refund is issued again, because the first one was taken back.
    const mid = await creditsFor(bookingId)
    expect(mid.data!.filter(c => c.status === 'open')).toHaveLength(1)

    await restore(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data!.every(c => c.status === 'settled')).toBe(true)
    // No phantom refund: the account-credit payment still stands in full.
    const pays = await paymentsFor(bookingId)
    expect(pays.data!.filter(p => p.status === 'refunded')).toHaveLength(0)
    const net = pays.data!.reduce(
      (s, p) => s + (p.status === 'paid' ? Number(p.amount) : p.status === 'refunded' ? -Number(p.amount) : 0), 0)
    expect(net).toBe(3000)
  })

  it('records a refund for the part already spent on another booking', async () => {
    const diver = await freshDiver()
    const diveA = await freshDive()
    const diveB = await freshDive()
    const bookingA = await makeBooking(diver.id, diveA, 3000)
    await makePayment(diver.id, bookingA, 3000, 'account_credit')
    await cancel(bookingA)

    // The diver spends 1,200 of the returned 3,000 on another booking.
    const bookingB = await makeBooking(diver.id, diveB, 1200)
    const diverApi = await userClient(diver.email, diver.password)
    const { data: applied } = await diverApi.rpc('apply_credit_to_booking', {
      p_booking_id: bookingB, p_amount: 1200,
    })
    expect(Number(applied)).toBe(1200)

    await restore(bookingA)

    // The 1,800 still open is reclaimed; the 1,200 that left cannot be, so
    // booking A's account-credit payment is reduced by exactly that much.
    const { data: credits } = await creditsFor(bookingA)
    expect(credits!.every(c => c.status === 'settled')).toBe(true)

    const pays = await paymentsFor(bookingA)
    const refunded = pays.data!.filter(p => p.status === 'refunded')
    expect(refunded).toHaveLength(1)
    expect(Number(refunded[0].amount)).toBe(1200)

    // Net paid on A is now 1,800 — the credit that genuinely still backs it.
    const net = pays.data!.reduce(
      (s, p) => s + (p.status === 'paid' ? Number(p.amount) : p.status === 'refunded' ? -Number(p.amount) : 0), 0)
    expect(net).toBe(1800)
  })
})
