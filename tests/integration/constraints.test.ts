import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser, createActivity, type TestUser
} from './helpers'

const admin = adminClient()
let user: TestUser
let activityId: string
const bookingIds: string[] = []

beforeAll(async () => {
  user = await createTestUser(admin)
  const a = await createActivity(admin)
  activityId = a.id
})

afterAll(async () => {
  if (bookingIds.length) await admin.from('bookings').delete().in('id', bookingIds)
  await admin.from('bookings').delete().eq('activity_id', activityId)
  await admin.from('activities').delete().eq('id', activityId)
  if (user) await deleteTestUser(admin, user.id).catch(() => {})
})

describe('DB constraints', () => {
  it('bookings UNIQUE(user_id, activity_id) rejects duplicates', async () => {
    const first = await admin
      .from('bookings')
      .insert({ user_id: user.id, activity_id: activityId, status: 'pending' })
      .select().single()
    if (first.data) bookingIds.push(first.data.id)
    expect(first.error).toBeNull()

    const dup = await admin
      .from('bookings')
      .insert({ user_id: user.id, activity_id: activityId, status: 'pending' })
    expect(dup.error).toBeTruthy()
    expect(String(dup.error?.message ?? '')).toMatch(/duplicate|unique/i)
  })

  it('profiles.role CHECK rejects values outside (customer, staff, admin)', async () => {
    const { error } = await admin
      .from('profiles')
      // @ts-expect-error — intentionally violating the typed enum
      .update({ role: 'hacker' })
      .eq('id', user.id)
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/role/i)
  })

  it('bookings.status CHECK rejects invalid status', async () => {
    const { error } = await admin
      .from('bookings')
      // @ts-expect-error
      .insert({ user_id: user.id, activity_id: activityId, status: 'made-up' })
    expect(error).toBeTruthy()
  })

  it('activities.type CHECK rejects invalid type', async () => {
    const { error } = await admin
      .from('activities')
      .insert({
        title: 'Bad type',
        // @ts-expect-error
        type: 'not-a-type',
        start_time: new Date().toISOString(),
      })
    expect(error).toBeTruthy()
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

  it('bookings.user_id FK rejects non-existent user', async () => {
    const { error } = await admin.from('bookings').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      activity_id: activityId,
      status: 'pending',
    })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('bookings.activity_id FK rejects non-existent activity', async () => {
    const { error } = await admin.from('bookings').insert({
      user_id: user.id,
      activity_id: '00000000-0000-0000-0000-000000000000',
      status: 'pending',
    })
    expect(error).toBeTruthy()
  })
})
