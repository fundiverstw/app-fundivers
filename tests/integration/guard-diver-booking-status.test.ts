// The bookings RLS self-insert / self-update policies gate the row (owner) but
// not the columns. This trigger closes that gap: a diver may create a booking
// only as pending/waitlisted and may only ever move it to cancelled. Privileged
// transitions (admin, or the SECURITY DEFINER waitlist/credit RPCs) still work —
// covered here for admin, and by waitlist-offers/apply-credit suites for the RPCs.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let diver: TestUser
const bookingIds: string[] = []
const diveIds: string[] = []

beforeAll(async () => {
  diver = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  if (bookingIds.length) await admin.from('bookings').delete().in('id', bookingIds)
  await admin.from('bookings').delete().eq('user_id', diver.id)
  for (const id of diveIds) await deleteTestDive(admin, id)
  if (diver) await deleteTestUser(admin, diver.id).catch(() => {})
})

async function freshDive(): Promise<string> {
  const id = await createTestDive(admin)
  diveIds.push(id)
  return id
}

// Insert via the service-role client, which bypasses the guard (current_user is
// not 'authenticated'), so tests can stage a booking in any state.
async function stageBooking(eventId: string, status = 'pending'): Promise<string> {
  const { data, error } = await admin
    .from('bookings')
    .insert({ user_id: diver.id, event_id: eventId, status })
    .select('id').single()
  if (error) throw new Error(`stageBooking failed: ${error.message}`)
  bookingIds.push(data!.id)
  return data!.id
}

describe('bookings: diver status/event guard', () => {
  it('lets a diver self-insert a pending booking', async () => {
    const api = await userClient(diver.email, diver.password)
    const { data, error } = await api
      .from('bookings')
      .insert({ user_id: diver.id, event_id: await freshDive(), status: 'pending' })
      .select('id').single()
    expect(error).toBeNull()
    if (data) bookingIds.push(data.id)
  })

  it('rejects a diver self-inserting a confirmed booking', async () => {
    const api = await userClient(diver.email, diver.password)
    const { error } = await api
      .from('bookings')
      .insert({ user_id: diver.id, event_id: await freshDive(), status: 'confirmed' })
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '')).toMatch(/created as pending or waitlisted/i)
  })

  it('rejects a diver promoting their own booking to confirmed', async () => {
    const id = await stageBooking(await freshDive())
    const api = await userClient(diver.email, diver.password)
    const { error } = await api.from('bookings').update({ status: 'confirmed' }).eq('id', id)
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '')).toMatch(/divers may only cancel/i)

    const { data: row } = await admin.from('bookings').select('status').eq('id', id).single()
    expect(row?.status).toBe('pending')
  })

  it('still lets a diver cancel their own booking', async () => {
    const id = await stageBooking(await freshDive())
    const api = await userClient(diver.email, diver.password)
    const { error } = await api.from('bookings').update({ status: 'cancelled' }).eq('id', id)
    expect(error).toBeNull()
    const { data: row } = await admin.from('bookings').select('status').eq('id', id).single()
    expect(row?.status).toBe('cancelled')
  })

  it('rejects a diver moving their booking to a different event', async () => {
    const id = await stageBooking(await freshDive())
    const target = await freshDive()
    const api = await userClient(diver.email, diver.password)
    const { error } = await api.from('bookings').update({ event_id: target }).eq('id', id)
    expect(error).not.toBeNull()
    expect(String(error?.message ?? '')).toMatch(/moved to a different event/i)
  })

  it('lets an admin confirm a booking through the app (authenticated admin session)', async () => {
    const adminUser = await createTestUser(admin, { role: 'admin' })
    try {
      const id = await stageBooking(await freshDive())
      const adminApi = await userClient(adminUser.email, adminUser.password)
      const { error } = await adminApi.from('bookings').update({ status: 'confirmed' }).eq('id', id)
      expect(error).toBeNull()
      const { data: row } = await admin.from('bookings').select('status').eq('id', id).single()
      expect(row?.status).toBe('confirmed')
    } finally {
      await deleteTestUser(admin, adminUser.id).catch(() => {})
    }
  })
})
