// Integration tests for the lead-booker-pays-for-the-group feature
// (20260622000000_lead_payer.sql). What we lock in:
//   1. bookings_validate_payer rejects a payer_id that's neither the diver
//      nor their parent, even under the service role; accepts self + parent.
//   2. The "profiles: child select parent" RLS lets a child read exactly
//      their own parent's row and nothing else (no recursion error).
//   3. record_group_payment distributes a lump deposits-first then balances,
//      oldest-first; confirms pending siblings; is admin-only; clamps to
//      outstanding; and produces one payment row per touched booking.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let parent: TestUser
let childA: TestUser
let childB: TestUser
let unrelated: TestUser
const cleanupUsers: string[] = []
const cleanupDives: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  parent    = await createTestUser(admin, { role: 'diver' })
  childA    = await createTestUser(admin, { role: 'diver' })
  childB    = await createTestUser(admin, { role: 'diver' })
  unrelated = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, parent.id, childA.id, childB.id, unrelated.id)

  const { error } = await admin
    .from('profiles')
    .update({ parent_account: parent.id } as never)
    .in('id', [childA.id, childB.id])
  if (error) throw error
})

afterAll(async () => {
  for (const id of cleanupDives) await deleteTestDive(admin, id)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

async function freshDive(): Promise<string> {
  const id = await createTestDive(admin)
  cleanupDives.push(id)
  return id
}

async function makeBooking(args: {
  userId: string
  diveId: string
  details: Record<string, unknown>
  status?: 'pending' | 'confirmed'
  payerId?: string
  createdAt?: string
}): Promise<string> {
  const row: Record<string, unknown> = {
    user_id: args.userId,
    eo_dive_id: args.diveId,
    status: args.status ?? 'pending',
    details: args.details,
  }
  if (args.payerId)   row.payer_id = args.payerId
  if (args.createdAt) row.created_at = args.createdAt
  const { data, error } = await admin.from('bookings').insert(row as never).select('id').single()
  if (error) throw new Error(`makeBooking failed: ${error.message}`)
  return (data as { id: string }).id
}

function paidSum(bookingId: string) {
  return admin.from('payments').select('amount, note').eq('booking_id', bookingId).eq('status', 'paid')
}
function bookingStatus(bookingId: string) {
  return admin.from('bookings').select('status').eq('id', bookingId).single()
}

describe('bookings_validate_payer', () => {
  it('rejects a payer_id that is neither the diver nor their parent (under service role)', async () => {
    const dive = await freshDive()
    const { error } = await admin.from('bookings').insert({
      user_id: childA.id, eo_dive_id: dive, status: 'pending', details: {}, payer_id: unrelated.id,
    } as never)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/payer_id must be/i)
  })

  it('accepts payer_id = the diver themselves', async () => {
    const dive = await freshDive()
    const id = await makeBooking({ userId: childA.id, diveId: dive, details: {}, payerId: childA.id })
    expect(id).toBeTruthy()
  })

  it('accepts payer_id = the parent account', async () => {
    const dive = await freshDive()
    const id = await makeBooking({ userId: childA.id, diveId: dive, details: {}, payerId: parent.id })
    expect(id).toBeTruthy()
  })
})

describe('profiles: child select parent RLS', () => {
  it('lets a child read exactly their own parent row, and nothing unrelated', async () => {
    const asChild = await userClient(childA.email, childA.password)

    const { data: hitParent, error } = await asChild
      .from('profiles').select('id').eq('id', parent.id).maybeSingle()
    expect(error).toBeNull()              // no 42P17 recursion
    expect(hitParent?.id).toBe(parent.id)

    const { data: missUnrelated } = await asChild
      .from('profiles').select('id').eq('id', unrelated.id).maybeSingle()
    expect(missUnrelated).toBeNull()
  })
})

describe('record_group_payment', () => {
  // Build a fresh 3-booking group (parent + 2 children), all payer_id=parent,
  // each total 6000 / deposit 2000, pending. Each group gets its own group_id
  // so tests stay isolated (parent is shared across tests); created_at is
  // staggered so "oldest-first" is deterministic. Every test scopes the RPC
  // with p_group_id.
  async function freshGroup() {
    const dive = await freshDive()
    const gid = crypto.randomUUID()
    const t0 = '2026-01-01T00:00:00Z'
    const t1 = '2026-01-01T00:00:01Z'
    const t2 = '2026-01-01T00:00:02Z'
    const details = { total: 6000, deposit: 2000, payment_method: 'bank_transfer' }
    const own = await makeBooking({ userId: parent.id, diveId: dive, details, payerId: parent.id, createdAt: t0 })
    const a   = await makeBooking({ userId: childA.id, diveId: dive, details, payerId: parent.id, createdAt: t1 })
    const b   = await makeBooking({ userId: childB.id, diveId: dive, details, payerId: parent.id, createdAt: t2 })
    await admin.from('bookings').update({ group_id: gid } as never).in('id', [own, a, b])
    return { gid, own, a, b }
  }

  it('is admin-only', async () => {
    const g = await freshGroup()
    const asParent = await userClient(parent.email, parent.password)
    const { error } = await asParent.rpc('record_group_payment', { p_lead: parent.id, p_amount: 1000, p_group_id: g.gid })
    expect(error).not.toBeNull()
    // No payment landed.
    expect((await paidSum(g.own)).data ?? []).toHaveLength(0)
  })

  it('covers every sibling deposit first and confirms all spots', async () => {
    const g = await freshGroup()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    // Sum of deposits = 6000.
    const { data, error } = await asAdmin.rpc('record_group_payment', { p_lead: parent.id, p_amount: 6000, p_group_id: g.gid })
    expect(error).toBeNull()
    expect(Number(data)).toBe(6000)

    for (const id of [g.own, g.a, g.b]) {
      const pays = (await paidSum(id)).data!
      expect(pays.reduce((s, p) => s + Number(p.amount), 0)).toBe(2000)
      expect(pays[0].note).toBe('Group payment')
      expect((await bookingStatus(id)).data?.status).toBe('confirmed')
    }
  })

  it('applies the remainder against balances and clamps to outstanding', async () => {
    const g = await freshGroup()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    // Way more than the 18000 owed across the group.
    const { data } = await asAdmin.rpc('record_group_payment', { p_lead: parent.id, p_amount: 999999, p_group_id: g.gid })
    expect(Number(data)).toBe(18000)
    for (const id of [g.own, g.a, g.b]) {
      const total = (await paidSum(id)).data!.reduce((s, p) => s + Number(p.amount), 0)
      expect(total).toBe(6000)
    }
  })

  it('deposits-first, oldest-first when the lump only covers one deposit', async () => {
    const g = await freshGroup()
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { data } = await asAdmin.rpc('record_group_payment', { p_lead: parent.id, p_amount: 2000, p_group_id: g.gid })
    expect(Number(data)).toBe(2000)
    // Oldest (parent's own) gets the deposit and confirms; the others stay pending.
    expect((await paidSum(g.own)).data!.reduce((s, p) => s + Number(p.amount), 0)).toBe(2000)
    expect((await bookingStatus(g.own)).data?.status).toBe('confirmed')
    expect((await paidSum(g.a)).data ?? []).toHaveLength(0)
    expect((await bookingStatus(g.a)).data?.status).toBe('pending')
    expect((await paidSum(g.b)).data ?? []).toHaveLength(0)
  })

  it('narrows to one group when p_group_id is given', async () => {
    const dive = await freshDive()
    const gid = crypto.randomUUID()
    const details = { total: 6000, deposit: 2000, payment_method: 'bank_transfer' }
    const inGroup  = await makeBooking({ userId: childA.id, diveId: dive, details, payerId: parent.id })
    await admin.from('bookings').update({ group_id: gid } as never).eq('id', inGroup)
    const otherDive = await freshDive()
    const outGroup = await makeBooking({ userId: childB.id, diveId: otherDive, details, payerId: parent.id })

    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { data } = await asAdmin.rpc('record_group_payment', { p_lead: parent.id, p_amount: 99999, p_group_id: gid })
    expect(Number(data)).toBe(6000)   // only the one in-group booking
    expect((await paidSum(inGroup)).data!.reduce((s, p) => s + Number(p.amount), 0)).toBe(6000)
    expect((await paidSum(outGroup)).data ?? []).toHaveLength(0)
  })

  it('rejects a non-positive amount', async () => {
    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const { error } = await asAdmin.rpc('record_group_payment', { p_lead: parent.id, p_amount: 0 })
    expect(error).not.toBeNull()
  })
})
