// Integration coverage for `event_ride_groups` — which of a day's events travel
// together. Runs against the live local Supabase stack.
//
// Contract (20260724000000_ride_groups_shared_transport):
//   - one row per (ride_day, event_id): an event rides on at most one run a day
//   - staff + admin can READ; only admins can INSERT / UPDATE / DELETE;
//     divers and anon see nothing and cannot write
//   - deleting the event cascades its grouping rows away
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
  type TestUser,
} from './helpers'

const admin = adminClient()

let adminUser: TestUser
let staff: TestUser
let diver: TestUser
let diveId: string
let courseId: string
const cleanupUsers: string[] = []
const DAY = '2031-05-04'

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staff     = await createTestUser(admin, { role: 'staff' })
  diver     = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, staff.id, diver.id)
  diveId   = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

async function clear() {
  await admin.from('event_ride_groups').delete().eq('ride_day', DAY)
}

describe('event_ride_groups shape', () => {
  it('groups a dive and a course onto one run', async () => {
    await clear()
    const g = crypto.randomUUID()
    const { error } = await admin.from('event_ride_groups').insert([
      { ride_day: DAY, event_id: diveId, group_id: g },
      { ride_day: DAY, event_id: courseId, group_id: g },
    ] as never)
    expect(error).toBeNull()
    const { data } = await admin.from('event_ride_groups').select('*').eq('ride_day', DAY)
    expect(data).toHaveLength(2)
    expect(new Set((data ?? []).map(r => r.group_id))).toEqual(new Set([g]))
  })

  it('refuses a second run for the same event on the same day', async () => {
    const { error } = await admin.from('event_ride_groups')
      .insert({ ride_day: DAY, event_id: diveId, group_id: crypto.randomUUID() } as never)
    expect(error).not.toBeNull()
  })

  it('lets the same event ride on a different run on another day', async () => {
    const other = '2031-05-05'
    const { error } = await admin.from('event_ride_groups')
      .insert({ ride_day: other, event_id: diveId, group_id: crypto.randomUUID() } as never)
    expect(error).toBeNull()
    await admin.from('event_ride_groups').delete().eq('ride_day', other)
  })

  it('moves an event to another run by upserting its row', async () => {
    const moved = crypto.randomUUID()
    const { error } = await admin.from('event_ride_groups')
      .upsert({ ride_day: DAY, event_id: courseId, group_id: moved } as never,
              { onConflict: 'ride_day,event_id' })
    expect(error).toBeNull()
    const { data } = await admin.from('event_ride_groups')
      .select('group_id').eq('ride_day', DAY).eq('event_id', courseId).single()
    expect(data?.group_id).toBe(moved)
  })

  it('rejects a row for an event that does not exist', async () => {
    const { error } = await admin.from('event_ride_groups')
      .insert({ ride_day: DAY, event_id: crypto.randomUUID(), group_id: crypto.randomUUID() } as never)
    expect(error).not.toBeNull()
  })
})

describe('event_ride_groups RLS', () => {
  beforeAll(async () => {
    await clear()
    const g = crypto.randomUUID()
    await admin.from('event_ride_groups').insert([
      { ride_day: DAY, event_id: diveId, group_id: g },
      { ride_day: DAY, event_id: courseId, group_id: g },
    ] as never)
  })

  it('lets staff read the day\'s runs', async () => {
    const c = await userClient(staff.email, staff.password)
    const { data, error } = await c.from('event_ride_groups').select('*').eq('ride_day', DAY)
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
  })

  it('hides them from divers and anon', async () => {
    const d = await userClient(diver.email, diver.password)
    const { data: asDiver } = await d.from('event_ride_groups').select('*').eq('ride_day', DAY)
    expect(asDiver).toEqual([])
    const { data: asAnon } = await anonClient().from('event_ride_groups').select('*').eq('ride_day', DAY)
    expect(asAnon ?? []).toEqual([])
  })

  it('refuses writes from staff and divers, and allows them from an admin', async () => {
    const day = '2031-06-06'
    const asStaff = await userClient(staff.email, staff.password)
    const staffWrite = await asStaff.from('event_ride_groups')
      .insert({ ride_day: day, event_id: diveId, group_id: crypto.randomUUID() } as never)
    expect(staffWrite.error).not.toBeNull()

    const asDiver = await userClient(diver.email, diver.password)
    const diverWrite = await asDiver.from('event_ride_groups')
      .insert({ ride_day: day, event_id: diveId, group_id: crypto.randomUUID() } as never)
    expect(diverWrite.error).not.toBeNull()

    const asAdmin = await userClient(adminUser.email, adminUser.password)
    const adminWrite = await asAdmin.from('event_ride_groups')
      .insert({ ride_day: day, event_id: diveId, group_id: crypto.randomUUID() } as never)
    expect(adminWrite.error).toBeNull()
    const adminDelete = await asAdmin.from('event_ride_groups').delete().eq('ride_day', day)
    expect(adminDelete.error).toBeNull()
  })

  it('cannot be deleted by a diver', async () => {
    const d = await userClient(diver.email, diver.password)
    await d.from('event_ride_groups').delete().eq('ride_day', DAY)
    const { data } = await admin.from('event_ride_groups').select('*').eq('ride_day', DAY)
    expect(data).toHaveLength(2)
  })
})

describe('event_ride_groups cascade', () => {
  it('goes away with the event', async () => {
    const throwaway = await createTestDive(admin)
    const day = '2031-07-07'
    await admin.from('event_ride_groups')
      .insert({ ride_day: day, event_id: throwaway, group_id: crypto.randomUUID() } as never)
    await deleteTestDive(admin, throwaway)
    const { data } = await admin.from('event_ride_groups').select('*').eq('ride_day', day)
    expect(data).toEqual([])
  })
})
