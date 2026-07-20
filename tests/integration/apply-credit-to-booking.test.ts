// Integration tests for the apply_credit_to_booking RPC — the one path a
// diver (or admin on their behalf) uses to spend open account credit toward
// a booking's unpaid balance. What we lock in:
//   1. A diver can self-apply; the call settles credit rows oldest-first,
//      carries any unspent remainder forward, and records an offsetting
//      'account_credit' paid payment.
//   2. The applied amount is clamped to min(requested, balance due, pool).
//   3. Crossing the deposit confirms a pending booking.
//   4. Credit already tied to the booking offsets its due and is never spent.
//   5. A diver cannot apply to someone else's booking; an admin can.
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
  userId: string, diveId: string,
  details: Record<string, unknown>, status: 'pending' | 'confirmed' = 'pending',
): Promise<string> {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: diveId, status, details,
  } as never).select('id').single()
  if (error) throw new Error(`makeBooking failed: ${error.message}`)
  return (data as { id: string }).id
}

async function makeCredit(userId: string, amount: number, bookingId: string | null = null): Promise<string> {
  const { data, error } = await admin.from('credits').insert({
    user_id: userId, amount, reason: 'test credit', created_by: adminUser.id, booking_id: bookingId,
  }).select('id').single()
  if (error) throw new Error(`makeCredit failed: ${error.message}`)
  return data!.id
}

function openCredits(userId: string) {
  return admin.from('credits').select('amount, booking_id, status').eq('user_id', userId).eq('status', 'open')
}
function paidPayments(bookingId: string) {
  return admin.from('payments').select('amount, method, status').eq('booking_id', bookingId).eq('status', 'paid')
}

describe('apply_credit_to_booking', () => {
  it('partial apply: settles the spent credit, carries the remainder forward, records a paid payment', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 3000 })
    await makeCredit(diver.id, 5000)

    const diverApi = await userClient(diver.email, diver.password)
    const { data, error } = await diverApi.rpc('apply_credit_to_booking', {
      p_booking_id: bookingId, p_amount: 1000,
    })
    expect(error).toBeNull()
    expect(Number(data)).toBe(1000)

    // One 'account_credit' paid payment for 1000.
    const pays = await paidPayments(bookingId)
    expect(pays.data).toHaveLength(1)
    expect(pays.data![0].method).toBe('account_credit')
    expect(Number(pays.data![0].amount)).toBe(1000)

    // The 5000 credit is settled; a 4000 remainder is carried forward open.
    const open = await openCredits(diver.id)
    expect(open.data).toHaveLength(1)
    expect(Number(open.data![0].amount)).toBe(4000)
  })

  it('nets refunds out of what counts as paid, so credit can clear the whole balance', async () => {
    // A refund is its own row with status 'refunded'; the app nets it out
    // everywhere (src/lib/payments.ts netPaid). The RPC used to sum only the
    // 'paid' rows, so a partly-refunded booking looked more paid to it than to
    // the screen — it applied less credit than the diver was shown as due and
    // left a residue they could not clear.
    const diver = await freshDiver()
    const dive = await freshDive()
    const booking = await makeBooking(diver.id, dive, { total: 3000 }, 'confirmed')
    await admin.from('payments').insert([
      { booking_id: booking, user_id: diver.id, amount: 1000, status: 'paid', method: 'cash' },
      { booking_id: booking, user_id: diver.id, amount: 300, status: 'refunded', method: 'cash' },
    ] as never)
    await makeCredit(diver.id, 5000)

    // net paid is 700, so 2300 is due — not the 2000 a paid-only sum implies.
    const db = await userClient(diver.email, diver.password)
    const { data: applied, error } = await db.rpc('apply_credit_to_booking', {
      p_booking_id: booking, p_amount: 2300,
    })
    expect(error).toBeNull()
    expect(Number(applied)).toBe(2300)

    // And the balance genuinely clears: 3000 owed - 700 net paid - 2300 credit.
    const { data: pays } = await admin
      .from('payments').select('amount, status').eq('booking_id', booking)
    const netPaid = (pays ?? []).reduce(
      (s, p) => s + (p.status === 'paid' ? Number(p.amount) : p.status === 'refunded' ? -Number(p.amount) : 0), 0)
    expect(3000 - netPaid).toBe(0)
  })

  it('counts only paid minus refunded — pending and voided rows move nothing', async () => {
    // Exercised through the RPC rather than by calling the helper directly:
    // booking_net_paid is SECURITY DEFINER with no ownership check, so it is
    // deliberately not granted to anyone.
    const diver = await freshDiver()
    const dive = await freshDive()
    const booking = await makeBooking(diver.id, dive, { total: 5000 }, 'confirmed')
    await admin.from('payments').insert([
      { booking_id: booking, user_id: diver.id, amount: 1000, status: 'paid',     method: 'cash' },
      { booking_id: booking, user_id: diver.id, amount: 250,  status: 'refunded', method: 'cash' },
      { booking_id: booking, user_id: diver.id, amount: 900,  status: 'pending',  method: 'cash' },
      { booking_id: booking, user_id: diver.id, amount: 400,  status: 'voided',   method: 'cash' },
    ] as never)
    await makeCredit(diver.id, 9000)

    // Net paid is 750 (1000 - 250), so 4250 is due. A sum that counted the
    // pending or voided rows, or ignored the refund, would clamp lower.
    const db = await userClient(diver.email, diver.password)
    const { data: applied } = await db.rpc('apply_credit_to_booking', {
      p_booking_id: booking, p_amount: 9000,
    })
    expect(Number(applied)).toBe(4250)
  })

  it('refuses to hand booking_net_paid to a diver directly', async () => {
    // It would otherwise expose any booking's payment total to any signed-in
    // user, since it takes a bare id and checks nothing.
    const diver = await freshDiver()
    const db = await userClient(diver.email, diver.password)
    const { error } = await db.rpc('booking_net_paid', {
      p_booking_id: '00000000-0000-4000-8000-000000000000',
    })
    expect(error).not.toBeNull()
  })

  it('clamps to the balance due when more is requested than owed', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 3000 })
    await makeCredit(diver.id, 5000)

    const diverApi = await userClient(diver.email, diver.password)
    const { data } = await diverApi.rpc('apply_credit_to_booking', {
      p_booking_id: bookingId, p_amount: 999999,
    })
    expect(Number(data)).toBe(3000)

    const open = await openCredits(diver.id)
    expect(open.data!.reduce((s, c) => s + Number(c.amount), 0)).toBe(2000)
  })

  it('clamps to the available pool when credit is the limiting factor', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 8000 })
    await makeCredit(diver.id, 1500)

    const diverApi = await userClient(diver.email, diver.password)
    const { data } = await diverApi.rpc('apply_credit_to_booking', {
      p_booking_id: bookingId, p_amount: 8000,
    })
    expect(Number(data)).toBe(1500)
    const open = await openCredits(diver.id)
    expect(open.data ?? []).toHaveLength(0)
  })

  it('confirms a pending booking once the deposit is covered by credit', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 6000, deposit: 2000 }, 'pending')
    await makeCredit(diver.id, 5000)

    const diverApi = await userClient(diver.email, diver.password)
    await diverApi.rpc('apply_credit_to_booking', { p_booking_id: bookingId, p_amount: 2000 })

    const b = await admin.from('bookings').select('status').eq('id', bookingId).single()
    expect(b.data?.status).toBe('confirmed')
  })

  it('never spends credit already tied to (and offsetting) the same booking', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 3000 })
    await makeCredit(diver.id, 1000, bookingId)   // tied to this booking — offsets due
    await makeCredit(diver.id, 5000)              // general pool

    const diverApi = await userClient(diver.email, diver.password)
    const { data } = await diverApi.rpc('apply_credit_to_booking', {
      p_booking_id: bookingId, p_amount: 999999,
    })
    // Due is 3000 - 1000 (tied credit) = 2000; only the general pool funds it.
    expect(Number(data)).toBe(2000)

    const open = await openCredits(diver.id)
    // The tied 1000 stays open; the general 5000 -> 3000 remainder.
    const tied = open.data!.find(c => c.booking_id === bookingId)
    expect(Number(tied?.amount)).toBe(1000)
    const general = open.data!.filter(c => c.booking_id === null).reduce((s, c) => s + Number(c.amount), 0)
    expect(general).toBe(3000)
  })

  it('returns 0 when the booking is already settled', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 1000 })
    await admin.from('payments').insert({
      user_id: diver.id, booking_id: bookingId, amount: 1000, status: 'paid', method: 'cash', recorded_by: adminUser.id,
    })
    await makeCredit(diver.id, 5000)

    const diverApi = await userClient(diver.email, diver.password)
    const { data } = await diverApi.rpc('apply_credit_to_booking', { p_booking_id: bookingId, p_amount: 1000 })
    expect(Number(data)).toBe(0)
    // Pool untouched.
    const open = await openCredits(diver.id)
    expect(open.data!.reduce((s, c) => s + Number(c.amount), 0)).toBe(5000)
  })

  it('rejects applying to another diver\'s booking, but an admin may', async () => {
    const diver = await freshDiver()
    const otherDiver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 3000 })
    await makeCredit(diver.id, 5000)

    // Another diver cannot apply to it.
    const otherApi = await userClient(otherDiver.email, otherDiver.password)
    const bad = await otherApi.rpc('apply_credit_to_booking', { p_booking_id: bookingId, p_amount: 1000 })
    expect(bad.error).not.toBeNull()

    // An admin can apply the owner's credit on their behalf.
    const adminApi = await userClient(adminUser.email, adminUser.password)
    const ok = await adminApi.rpc('apply_credit_to_booking', { p_booking_id: bookingId, p_amount: 1000 })
    expect(ok.error).toBeNull()
    expect(Number(ok.data)).toBe(1000)
  })

  it('rejects applying to a cancelled booking and leaves the credit pool intact', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 3000 })
    // A cancelled booking still carries its frozen details.total; the RPC must
    // refuse rather than burn credit into a dead booking (the bug this guards).
    await admin.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)
    await makeCredit(diver.id, 5000)

    const diverApi = await userClient(diver.email, diver.password)
    const bad = await diverApi.rpc('apply_credit_to_booking', { p_booking_id: bookingId, p_amount: 1000 })
    expect(bad.error).not.toBeNull()

    // Nothing was spent: no payment recorded, pool untouched.
    const pays = await paidPayments(bookingId)
    expect(pays.data ?? []).toHaveLength(0)
    const open = await openCredits(diver.id)
    expect(open.data!.reduce((s, c) => s + Number(c.amount), 0)).toBe(5000)

    // An admin is blocked too — the booking is dead for every caller.
    const adminApi = await userClient(adminUser.email, adminUser.password)
    const badAdmin = await adminApi.rpc('apply_credit_to_booking', { p_booking_id: bookingId, p_amount: 1000 })
    expect(badAdmin.error).not.toBeNull()
  })

  it('rejects a non-positive amount', async () => {
    const diver = await freshDiver()
    const dive = await freshDive()
    const bookingId = await makeBooking(diver.id, dive, { total: 3000 })
    await makeCredit(diver.id, 5000)

    const diverApi = await userClient(diver.email, diver.password)
    const zero = await diverApi.rpc('apply_credit_to_booking', { p_booking_id: bookingId, p_amount: 0 })
    expect(zero.error).not.toBeNull()
  })
})
