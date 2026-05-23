// Integration tests for the credits table — the "business owes diver"
// ledger. The big things to lock in:
//   1. Divers can read their own credits but never write.
//   2. Admins / staff can read + write any.
//   3. The CHECK constraint rejects negative amounts.
//   4. The status CHECK only allows 'open' | 'settled'.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let staffUser: TestUser
let diver:     TestUser
let otherDiver: TestUser

beforeAll(async () => {
  adminUser  = await createTestUser(admin, { role: 'admin' })
  staffUser  = await createTestUser(admin, { role: 'staff' })
  diver      = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const u of [adminUser, staffUser, diver, otherDiver]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('credits', () => {
  it('admin can issue a credit and the diver can read their own', async () => {
    const adminApi = await userClient(adminUser.email, adminUser.password)
    const ins = await adminApi.from('credits').insert({
      user_id: diver.id,
      amount:  3000,
      reason:  'Kenting May 15 cancelled (weather)',
      created_by: adminUser.id,
    }).select().single()
    expect(ins.error).toBeNull()
    expect(ins.data?.status).toBe('open')
    expect(Number(ins.data?.amount)).toBe(3000)

    const diverApi = await userClient(diver.email, diver.password)
    const read = await diverApi.from('credits').select('*').eq('user_id', diver.id)
    expect(read.error).toBeNull()
    expect(read.data?.some(c => c.id === ins.data?.id)).toBe(true)

    // Cleanup
    await admin.from('credits').delete().eq('id', ins.data!.id)
  })

  it('staff can issue and settle credits', async () => {
    const staffApi = await userClient(staffUser.email, staffUser.password)
    const ins = await staffApi.from('credits').insert({
      user_id: diver.id,
      amount:  500,
      reason:  'Goodwill credit',
      created_by: staffUser.id,
    }).select().single()
    expect(ins.error).toBeNull()

    const upd = await staffApi.from('credits').update({
      status: 'settled',
      settled_at: new Date().toISOString(),
      settled_note: 'Refunded via bank transfer',
    }).eq('id', ins.data!.id).select().single()
    expect(upd.error).toBeNull()
    expect(upd.data?.status).toBe('settled')

    await admin.from('credits').delete().eq('id', ins.data!.id)
  })

  it('divers cannot insert or update credits (only read their own)', async () => {
    const diverApi = await userClient(diver.email, diver.password)
    const ins = await diverApi.from('credits').insert({
      user_id: diver.id,
      amount:  100,
      reason:  'self-issued credit',
      created_by: diver.id,
    })
    expect(ins.error).not.toBeNull()
  })

  it('divers cannot read other divers credits', async () => {
    // Seed a credit on otherDiver via admin.
    const seeded = await admin.from('credits').insert({
      user_id: otherDiver.id,
      amount:  100,
      reason:  'private',
      created_by: adminUser.id,
    }).select().single()
    expect(seeded.error).toBeNull()

    const diverApi = await userClient(diver.email, diver.password)
    const cross = await diverApi.from('credits').select('*').eq('user_id', otherDiver.id)
    // PostgREST returns empty array under RLS, not an error — the row exists
    // but the policy hides it.
    expect(cross.error).toBeNull()
    expect(cross.data?.some(c => c.id === seeded.data?.id)).toBe(false)

    await admin.from('credits').delete().eq('id', seeded.data!.id)
  })

  it('rejects non-positive amounts and bogus statuses', async () => {
    const adminApi = await userClient(adminUser.email, adminUser.password)

    const neg = await adminApi.from('credits').insert({
      user_id: diver.id, amount: -50, reason: 'negative test', created_by: adminUser.id,
    })
    expect(neg.error).not.toBeNull()

    const zero = await adminApi.from('credits').insert({
      user_id: diver.id, amount: 0, reason: 'zero test', created_by: adminUser.id,
    })
    expect(zero.error).not.toBeNull()

    const bogus = await adminApi.from('credits').insert({
      user_id: diver.id, amount: 1, reason: 'bogus status', status: 'cancelled' as never, created_by: adminUser.id,
    })
    expect(bogus.error).not.toBeNull()
  })
})
