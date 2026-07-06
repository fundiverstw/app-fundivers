import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser,
  createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
  type TestUser,
} from './helpers'

const admin = adminClient()
let user: TestUser
let diveId: string
let courseId: string
const bookingIds: string[] = []

beforeAll(async () => {
  user = await createTestUser(admin)
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  if (bookingIds.length) await admin.from('bookings').delete().in('id', bookingIds)
  await admin.from('bookings').delete().eq('user_id', user.id)
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  if (user) await deleteTestUser(admin, user.id).catch(() => {})
})

describe('bookings: one active booking per (user, event)', () => {
  it('blocks a second active booking for the same dive event', async () => {
    const first = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: diveId, status: 'pending' })
      .select().single()
    expect(first.error).toBeNull()
    if (first.data) bookingIds.push(first.data.id)

    const dup = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: diveId, status: 'pending' })
    expect(dup.error).not.toBeNull()
    expect(String(dup.error?.message ?? '')).toMatch(/bookings_one_active_per_user_idx|duplicate key/i)

    await admin.from('bookings').delete().eq('id', first.data!.id)
  })

  it('blocks a second active booking for the same course event', async () => {
    const first = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: courseId, status: 'pending' })
      .select().single()
    expect(first.error).toBeNull()
    if (first.data) bookingIds.push(first.data.id)

    const dup = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: courseId, status: 'pending' })
    expect(dup.error).not.toBeNull()
    expect(String(dup.error?.message ?? '')).toMatch(/bookings_one_active_per_user_idx|duplicate key/i)

    await admin.from('bookings').delete().eq('id', first.data!.id)
  })

  it('allows a new booking after the prior one was cancelled — keeps audit row', async () => {
    const first = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: diveId, status: 'pending' })
      .select().single()
    expect(first.error).toBeNull()
    if (first.data) bookingIds.push(first.data.id)

    await admin.from('bookings').update({ status: 'cancelled' }).eq('id', first.data!.id)

    const second = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: diveId, status: 'pending' })
      .select().single()
    expect(second.error).toBeNull()
    if (second.data) bookingIds.push(second.data.id)

    const { data: rows } = await admin
      .from('bookings').select('id, status').eq('user_id', user.id).eq('event_id', diveId)
    expect(rows?.length).toBe(2)
    expect(rows?.filter(r => r.status === 'cancelled').length).toBe(1)
    expect(rows?.filter(r => r.status === 'pending').length).toBe(1)
  })

  it('allows two cancelled rows for the same event (audit trail unaffected)', async () => {
    const fresh = await createTestDive(admin)
    try {
      const a = await admin
        .from('bookings')
        .insert({ user_id: user.id, event_id: fresh, status: 'cancelled' })
        .select().single()
      const b = await admin
        .from('bookings')
        .insert({ user_id: user.id, event_id: fresh, status: 'cancelled' })
        .select().single()
      expect(a.error).toBeNull()
      expect(b.error).toBeNull()
      if (a.data) bookingIds.push(a.data.id)
      if (b.data) bookingIds.push(b.data.id)
    } finally {
      await admin.from('bookings').delete().eq('event_id', fresh)
      await deleteTestDive(admin, fresh)
    }
  })
})
