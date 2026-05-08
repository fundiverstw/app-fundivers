import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser:  TestUser
let staffUser:  TestUser
let diver:      TestUser
let otherDiver: TestUser
const diveIds: string[] = []

async function freshDive(): Promise<string> {
  const id = await createTestDive(admin)
  diveIds.push(id)
  return id
}

async function bookingFor(userId: string): Promise<string> {
  const dive = await freshDive()
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, eo_dive_id: dive, status: 'pending', details: {},
  }).select('id').single()
  if (error) throw error
  return data.id
}

beforeAll(async () => {
  adminUser  = await createTestUser(admin, { role: 'admin' })
  staffUser  = await createTestUser(admin, { role: 'staff' })
  diver      = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of diveIds) await deleteTestDive(admin, id)
  for (const u of [adminUser, staffUser, diver, otherDiver]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('booking_amendments', () => {
  it('admin can insert; created_by must equal auth.uid()', async () => {
    const bookingId = await bookingFor(diver.id)
    const adminApi = await userClient(adminUser.email, adminUser.password)

    const ok = await adminApi.from('booking_amendments').insert({
      booking_id: bookingId, amount: 500, note: 'extra night',
      created_by: adminUser.id,
    }).select().single()
    expect(ok.error).toBeNull()
    expect(ok.data?.amount).toBe(500)

    // Spoofing created_by → blocked.
    const spoofed = await adminApi.from('booking_amendments').insert({
      booking_id: bookingId, amount: 100, note: 'spoofed',
      created_by: diver.id,
    })
    expect(spoofed.error).not.toBeNull()
  })

  it('non-admin (diver, staff) cannot insert', async () => {
    const bookingId = await bookingFor(diver.id)

    const diverApi = await userClient(diver.email, diver.password)
    const r1 = await diverApi.from('booking_amendments').insert({
      booking_id: bookingId, amount: 100, note: 'sneaky', created_by: diver.id,
    })
    expect(r1.error).not.toBeNull()

    const staffApi = await userClient(staffUser.email, staffUser.password)
    const r2 = await staffApi.from('booking_amendments').insert({
      booking_id: bookingId, amount: 100, note: 'staff try', created_by: staffUser.id,
    })
    expect(r2.error).not.toBeNull()
  })

  it('diver sees own amendments; cannot see another diver\'s', async () => {
    const myBooking    = await bookingFor(diver.id)
    const otherBooking = await bookingFor(otherDiver.id)
    await admin.from('booking_amendments').insert([
      { booking_id: myBooking,    amount:  200, note: 'mine',  created_by: adminUser.id },
      { booking_id: otherBooking, amount: -100, note: 'other', created_by: adminUser.id },
    ])

    const diverApi = await userClient(diver.email, diver.password)
    const { data } = await diverApi.from('booking_amendments').select('*')
    const visible = data ?? []
    expect(visible.some(r => r.booking_id === myBooking)).toBe(true)
    expect(visible.some(r => r.booking_id === otherBooking)).toBe(false)
  })

  it('staff/admin see all amendments across bookings', async () => {
    const b1 = await bookingFor(diver.id)
    const b2 = await bookingFor(otherDiver.id)
    await admin.from('booking_amendments').insert([
      { booking_id: b1, amount:  50, note: 'a', created_by: adminUser.id },
      { booking_id: b2, amount: -75, note: 'b', created_by: adminUser.id },
    ])

    const staffApi = await userClient(staffUser.email, staffUser.password)
    const { data } = await staffApi.from('booking_amendments')
      .select('*').in('booking_id', [b1, b2])
    expect(data?.length).toBeGreaterThanOrEqual(2)
  })

  it('append-only: update and delete are blocked even for admins', async () => {
    const bookingId = await bookingFor(diver.id)
    const { data: row } = await admin.from('booking_amendments').insert({
      booking_id: bookingId, amount: 300, note: 'first', created_by: adminUser.id,
    }).select('id').single()

    const adminApi = await userClient(adminUser.email, adminUser.password)
    // No UPDATE policy → 0 rows touched.
    const upd = await adminApi.from('booking_amendments')
      .update({ amount: 999 } as never).eq('id', row!.id).select()
    expect(upd.data?.length ?? 0).toBe(0)

    // No DELETE policy → 0 rows touched.
    const del = await adminApi.from('booking_amendments')
      .delete().eq('id', row!.id).select()
    expect(del.data?.length ?? 0).toBe(0)

    // Row still there with original amount.
    const { data: still } = await admin.from('booking_amendments')
      .select('*').eq('id', row!.id).single()
    expect(still?.amount).toBe(300)
  })

  it('amount = 0 rejected by check constraint', async () => {
    const bookingId = await bookingFor(diver.id)
    const r = await admin.from('booking_amendments').insert({
      booking_id: bookingId, amount: 0, note: 'zero', created_by: adminUser.id,
    })
    expect(r.error).not.toBeNull()
  })

  it('blank note rejected by check constraint', async () => {
    const bookingId = await bookingFor(diver.id)
    const r = await admin.from('booking_amendments').insert({
      booking_id: bookingId, amount: 50, note: '   ', created_by: adminUser.id,
    })
    expect(r.error).not.toBeNull()
  })
})
