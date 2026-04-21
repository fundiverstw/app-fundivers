import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser, userClient,
  createActivity, type TestUser
} from './helpers'

const admin = adminClient()
let me: TestUser
let other: TestUser
let staff: TestUser
let activityId: string
const createdBookingIds: string[] = []

beforeAll(async () => {
  me = await createTestUser(admin)
  other = await createTestUser(admin)
  staff = await createTestUser(admin, { role: 'staff' })
  const a = await createActivity(admin)
  activityId = a.id

  // Seed one booking for each customer
  const { data: myBooking } = await admin
    .from('bookings')
    .insert({ user_id: me.id, activity_id: activityId, status: 'confirmed' })
    .select().single()
  if (myBooking) createdBookingIds.push(myBooking.id)
})

afterAll(async () => {
  if (createdBookingIds.length) {
    await admin.from('bookings').delete().in('id', createdBookingIds)
  }
  await admin.from('bookings').delete().eq('activity_id', activityId)
  await admin.from('activities').delete().eq('id', activityId)
  for (const u of [me, other, staff]) await deleteTestUser(admin, u.id).catch(() => {})
})

// RLS is currently disabled app-wide (see migration 20260421130941_remote_schema.sql).
// Unskip this suite once RLS is re-enabled on public.bookings.
describe.skip('bookings RLS', () => {
  it('a customer sees only their own bookings', async () => {
    const c = await userClient(me.email, me.password)
    const { data } = await c.from('bookings').select('user_id')
    expect(data ?? []).not.toHaveLength(0)
    for (const row of data!) expect(row.user_id).toBe(me.id)
  })

  it('a customer cannot insert a booking for someone else', async () => {
    const c = await userClient(me.email, me.password)
    const { error } = await c.from('bookings').insert({
      user_id: other.id,
      activity_id: activityId,
      status: 'pending',
    })
    expect(error).toBeTruthy()
  })

  it('a customer can insert a booking for themselves', async () => {
    // Need a fresh activity so we don't collide with the UNIQUE(user_id,activity_id).
    const a = await createActivity(admin, { title: 'Self-book test' })
    const c = await userClient(me.email, me.password)
    const { data, error } = await c
      .from('bookings')
      .insert({ user_id: me.id, activity_id: a.id, status: 'pending' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.user_id).toBe(me.id)
    if (data) createdBookingIds.push(data.id)
    await admin.from('activities').delete().eq('id', a.id)
  })

  it('staff can see all bookings', async () => {
    const s = await userClient(staff.email, staff.password)
    const { data } = await s.from('bookings').select('user_id').eq('activity_id', activityId)
    const users = new Set((data ?? []).map(r => r.user_id))
    expect(users.has(me.id)).toBe(true)
  })
})
