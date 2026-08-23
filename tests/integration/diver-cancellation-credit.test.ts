// A diver who pulls out IN TIME gets everything they paid back as credit; a
// diver who pulls out late gets only the account credit they had spent, and the
// rest goes to the holding list for a human. The deadline is the event's
// cancel-by date, and the moment that counts is when the DIVER asked, not when
// an admin got round to approving.
//
// The trigger is the only implementation: both approval call sites
// (AdminRefundsPage and AdminEventDetailPage) just set status = 'cancelled', so
// putting the rule anywhere else would let them drift.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { adminClient, createTestUser, deleteTestUser, createTestDive, deleteTestDive, type TestUser } from './helpers'
import { siteConfig } from '../../src/config/site'

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

/** A dive whose cancel-by date is `daysFromNow` away (null = no deadline set). */
async function diveWithDeadline(daysFromNow: number | null): Promise<string> {
  const id = await createTestDive(admin)
  cleanupDives.push(id)
  const cancelDate = daysFromNow === null
    ? null
    : new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10)
  const { error } = await admin.from('events').update({ cancel_date: cancelDate } as never).eq('id', id)
  if (error) throw new Error(error.message)
  return id
}

async function booking(userId: string, eventId: string, opts: {
  requestedDaysAgo?: number | null
} = {}): Promise<string> {
  const requested = opts.requestedDaysAgo == null
    ? null
    : new Date(Date.now() - opts.requestedDaysAgo * 86_400_000).toISOString()
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: eventId, status: 'confirmed',
    details: { total: 5000 }, refund_requested_at: requested,
  } as never).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

async function pay(userId: string, bookingId: string, amount: number, method: string): Promise<void> {
  const { error } = await admin.from('payments').insert({
    user_id: userId, booking_id: bookingId, amount, status: 'paid', method, note: 'test', reference: `R-${amount}`,
  })
  if (error) throw new Error(error.message)
}

async function cancel(bookingId: string): Promise<void> {
  const { error } = await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
  if (error) throw new Error(error.message)
}

function creditsFor(bookingId: string) {
  return admin.from('credits').select('amount, status, reason, source').eq('booking_id', bookingId)
}

describe('shop_timezone()', () => {
  // SQL cannot read fundive.config.ts, so the timezone is restated in the
  // database. If a fork changes one and not the other, "on or before the
  // cancel-by date" silently shifts by hours and divers lose refunds.
  it('matches the configured shop timezone', async () => {
    const { data, error } = await admin.rpc('shop_timezone' as never)
    expect(error).toBeNull()
    expect(data).toBe(siteConfig.locale.timezone)
  })
})

describe('credit on a diver cancellation', () => {
  it('credits the full amount paid when the diver asked before the cancel-by date', async () => {
    const diver = await freshDiver()
    const dive = await diveWithDeadline(3)          // deadline still three days out
    const b = await booking(diver.id, dive, { requestedDaysAgo: 0 })
    await pay(diver.id, b, 5000, 'bank_transfer')

    await cancel(b)

    const { data } = await creditsFor(b)
    expect(data).toHaveLength(1)
    expect(Number(data![0].amount)).toBe(5000)
    expect(data![0].status).toBe('open')
    expect(data![0].reason).toMatch(/cancel-by date/i)
  })

  it('credits only the account credit when the diver asked after the deadline', async () => {
    const diver = await freshDiver()
    const dive = await diveWithDeadline(-2)         // deadline passed two days ago
    const b = await booking(diver.id, dive, { requestedDaysAgo: 0 })
    await pay(diver.id, b, 3000, 'bank_transfer')
    await pay(diver.id, b, 2000, 'account_credit')

    await cancel(b)

    // The 2,000 of store credit comes back; the 3,000 of cash is a decision for
    // a human, so it stays on the holding list rather than being forfeited.
    const { data } = await creditsFor(b)
    expect(data).toHaveLength(1)
    expect(Number(data![0].amount)).toBe(2000)
    expect(data![0].reason).toMatch(/account credit returned/i)
  })

  it('forfeits nothing automatically: a late all-cash cancellation issues no credit', async () => {
    const diver = await freshDiver()
    const dive = await diveWithDeadline(-2)
    const b = await booking(diver.id, dive, { requestedDaysAgo: 0 })
    await pay(diver.id, b, 5000, 'bank_transfer')

    await cancel(b)

    const { data } = await creditsFor(b)
    expect(data ?? []).toHaveLength(0)
  })

  it('treats an event with no cancel-by date as always in time', async () => {
    const diver = await freshDiver()
    const dive = await diveWithDeadline(null)
    const b = await booking(diver.id, dive, { requestedDaysAgo: 30 })
    await pay(diver.id, b, 5000, 'bank_transfer')

    await cancel(b)

    const { data } = await creditsFor(b)
    expect(Number(data![0].amount)).toBe(5000)
  })

  it('judges the deadline by when the diver asked, not when the admin approved', async () => {
    const diver = await freshDiver()
    // The deadline passed yesterday, but the diver asked three days ago — in
    // time. A slow approval must not cost them the refund.
    const dive = await diveWithDeadline(-1)
    const b = await booking(diver.id, dive, { requestedDaysAgo: 3 })
    await pay(diver.id, b, 5000, 'bank_transfer')

    await cancel(b)

    const { data } = await creditsFor(b)
    expect(Number(data![0].amount)).toBe(5000)
  })

  it('credits nothing extra when an admin cancels a booking nobody asked about', async () => {
    const diver = await freshDiver()
    const dive = await diveWithDeadline(3)
    const b = await booking(diver.id, dive, { requestedDaysAgo: null })
    await pay(diver.id, b, 5000, 'bank_transfer')

    await cancel(b)

    // Not a diver cancellation, so the cash goes to the holding list.
    const { data } = await creditsFor(b)
    expect(data ?? []).toHaveLength(0)
  })

  it('never credits more than was actually paid, net of earlier refunds', async () => {
    const diver = await freshDiver()
    const dive = await diveWithDeadline(3)
    const b = await booking(diver.id, dive, { requestedDaysAgo: 0 })
    await pay(diver.id, b, 5000, 'bank_transfer')
    const { error } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: b, amount: 1500, status: 'refunded', method: 'bank_transfer', note: 'partial', reference: 'R-1500',
    })
    if (error) throw new Error(error.message)

    await cancel(b)

    const { data } = await creditsFor(b)
    expect(Number(data![0].amount)).toBe(3500)
  })
})
