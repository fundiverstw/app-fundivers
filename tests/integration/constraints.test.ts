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

describe('bookings constraints', () => {
  it('requires exactly one of eo_dive_id or eo_course_id (XOR check)', async () => {
    // both null → rejected
    const neither = await admin
      .from('bookings')
      .insert({ user_id: user.id, status: 'pending' })
    expect(neither.error).toBeTruthy()
    expect(String(neither.error?.message ?? '')).toMatch(/bookings_event_xor|check/i)

    // both set → rejected
    const both = await admin
      .from('bookings')
      .insert({ user_id: user.id, eo_dive_id: diveId, eo_course_id: courseId, status: 'pending' })
    expect(both.error).toBeTruthy()
  })

  it('accepts a dive-only booking', async () => {
    const { data, error } = await admin
      .from('bookings')
      .insert({ user_id: user.id, eo_dive_id: diveId, status: 'pending' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.eo_dive_id).toBe(diveId)
    expect(data!.eo_course_id).toBeNull()
    if (data) bookingIds.push(data.id)
  })

  it('accepts a course-only booking', async () => {
    const { data, error } = await admin
      .from('bookings')
      .insert({ user_id: user.id, eo_course_id: courseId, status: 'pending' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.eo_course_id).toBe(courseId)
    expect(data!.eo_dive_id).toBeNull()
    if (data) bookingIds.push(data.id)
  })

  it('rejects a duplicate (user, dive) booking', async () => {
    // The partial unique index fires only for a second dive booking from the same user.
    const dup = await admin
      .from('bookings')
      .insert({ user_id: user.id, eo_dive_id: diveId, status: 'pending' })
    expect(dup.error).toBeTruthy()
    expect(String(dup.error?.message ?? '')).toMatch(/duplicate|unique/i)
  })

  it('rejects an invalid status', async () => {
    const { error } = await admin
      .from('bookings')
      // @ts-expect-error — intentionally bad status
      .insert({ user_id: user.id, eo_dive_id: diveId, status: 'made-up' })
    expect(error).toBeTruthy()
  })

  it('rejects a non-existent eo_dive_id (FK)', async () => {
    const { error } = await admin
      .from('bookings')
      .insert({ user_id: user.id, eo_dive_id: 'does_not_exist', status: 'pending' })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('rejects a non-existent eo_course_id (FK)', async () => {
    const { error } = await admin
      .from('bookings')
      .insert({ user_id: user.id, eo_course_id: 'does_not_exist', status: 'pending' })
    expect(error).toBeTruthy()
  })

  it('rejects a non-existent user (FK)', async () => {
    const { error } = await admin.from('bookings').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      eo_dive_id: diveId,
      status: 'pending',
    })
    expect(error).toBeTruthy()
  })
})

describe('other constraints', () => {
  it('profiles.role CHECK rejects values outside (customer, staff, admin)', async () => {
    const { error } = await admin
      .from('profiles')
      // @ts-expect-error — intentionally bad role
      .update({ role: 'hacker' })
      .eq('id', user.id)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/role/i)
  })

  it('payments.status CHECK rejects invalid status', async () => {
    const { error } = await admin
      .from('payments')
      .insert({
        user_id: user.id,
        amount: 100,
        // @ts-expect-error
        status: 'wild-west',
      })
    expect(error).toBeTruthy()
  })
})
