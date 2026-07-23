// Integration tests for trg_bookings_return_account_credit_on_cancel — the
// trigger that hands a diver's account credit back when their booking is
// cancelled. What we lock in:
//   1. Cancelling a booking paid with account credit issues a fresh open credit
//      for the amount consumed, tied to that booking.
//   2. Off-app methods (bank transfer, cash) are left alone — those refunds
//      move off-app when the refund request is approved.
//   3. It is idempotent: a booking that already carries a credit is skipped, so
//      an event cancellation followed by a booking cancellation never pays out
//      twice.
//   4. A prior reversal is netted out, so a partially refunded credit spend
//      only returns what is still outstanding.
//   5. The returned credit is spendable again — it lands back in the diver's
//      open balance rather than staying pinned to the dead booking.
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
  })
  if (error) throw new Error(`makePayment failed: ${error.message}`)
}

async function cancel(bookingId: string): Promise<void> {
  const { error } = await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
  if (error) throw new Error(`cancel failed: ${error.message}`)
}

function creditsFor(bookingId: string) {
  return admin.from('credits').select('amount, status, reason').eq('booking_id', bookingId)
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

  it('does not double-issue when the booking already carries a credit', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')
    // Stands in for the event-cancellation credit, which already refunds the
    // diver's full net paid for this booking.
    const { error } = await admin.from('credits').insert({
      user_id: diver.id, booking_id: bookingId, amount: 3000,
      reason: 'Refund credit for cancelled event', created_by: adminUser.id,
    })
    if (error) throw new Error(error.message)

    await cancel(bookingId)

    const { data } = await creditsFor(bookingId)
    expect(data).toHaveLength(1)
    expect(data![0].reason).toContain('cancelled event')
  })

  it('only fires on the transition into cancelled, not on later updates', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, 3000)
    await makePayment(diver.id, bookingId, 3000, 'account_credit')

    await cancel(bookingId)
    // A second write that leaves the status cancelled must not re-issue. The
    // idempotency guard covers this too, but the WHEN clause is the first line
    // of defence and this pins it.
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
