// Integration coverage for `event_vehicles` — per-event car allocation.
// Runs against the live local Supabase stack.
//
// Contract (20260627000000_event_vehicles.sql):
//   - exactly one of eo_dive_id / eo_course_id (XOR check)
//   - a vehicle is allocated to at most one event per date
//     (unique vehicle_id + event_date) — the exclusivity rule
//   - staff + admin can READ; only admins can INSERT / UPDATE / DELETE;
//     divers and anon see nothing and cannot write
//   - deleting a vehicle (or its event) cascades the allocation away
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
  type TestUser,
} from './helpers'

const admin = adminClient()
const DAY = '2031-03-15'
const OTHER_DAY = '2031-03-16'

let adminUser: TestUser
let staff: TestUser
let diver: TestUser
let diveId: string
let courseId: string
const cleanupUsers: string[] = []
const cleanupVehicles: string[] = []

async function createVehicle(name: string): Promise<string> {
  const { data, error } = await admin.from('vehicles')
    .insert({ name, passenger_seats: 7 } as never).select('id').single()
  if (error) throw new Error(`createVehicle failed: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupVehicles.push(id)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staff     = await createTestUser(admin, { role: 'staff' })
  diver     = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, staff.id, diver.id)
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  for (const id of cleanupVehicles) await admin.from('vehicles').delete().eq('id', id)
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('event_vehicles XOR + exclusivity', () => {
  it('accepts a dive-only and a course-only allocation', async () => {
    const v = await createVehicle('XOR Van')
    const { error: diveErr } = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY, eo_dive_id: diveId } as never)
    expect(diveErr).toBeNull()

    const v2 = await createVehicle('XOR Bus')
    const { error: courseErr } = await admin.from('event_vehicles')
      .insert({ vehicle_id: v2, event_date: DAY, eo_course_id: courseId } as never)
    expect(courseErr).toBeNull()
  })

  it('rejects an allocation that targets neither event', async () => {
    const v = await createVehicle('Orphan Van')
    const { error } = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY } as never)
    expect(error).not.toBeNull()
  })

  it('rejects an allocation that targets both events', async () => {
    const v = await createVehicle('Both Van')
    const { error } = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY, eo_dive_id: diveId, eo_course_id: courseId } as never)
    expect(error).not.toBeNull()
  })

  it('rejects the same car on a second event the same day, but allows it on another day', async () => {
    const v = await createVehicle('Exclusive Van')
    const first = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY, eo_dive_id: diveId } as never)
    expect(first.error).toBeNull()

    // Same car, same day, different event → blocked by the unique index.
    const clash = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY, eo_course_id: courseId } as never)
    expect(clash.error).not.toBeNull()

    // Same car, different day → fine.
    const nextDay = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: OTHER_DAY, eo_course_id: courseId } as never)
    expect(nextDay.error).toBeNull()
  })
})

describe('event_vehicles RLS', () => {
  it('lets staff and admin read allocations, but not divers or anon', async () => {
    const v = await createVehicle('Read Van')
    const { data: row } = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY, eo_dive_id: diveId } as never).select('id').single()
    const id = (row as { id: string }).id

    const staffC = await userClient(staff.email, staff.password)
    const { data: staffRows } = await staffC.from('event_vehicles').select('*').eq('id', id)
    expect(staffRows?.length).toBe(1)

    const diverC = await userClient(diver.email, diver.password)
    const { data: diverRows } = await diverC.from('event_vehicles').select('*').eq('id', id)
    expect(diverRows?.length).toBe(0)

    const { data: anonRows } = await anonClient().from('event_vehicles').select('*').eq('id', id)
    expect(anonRows?.length).toBe(0)
  })

  it('only admins can write; staff and divers are blocked', async () => {
    const v = await createVehicle('Write Van')

    const adminC = await userClient(adminUser.email, adminUser.password)
    const { error: adminErr } = await adminC.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY, eo_dive_id: diveId } as never)
    expect(adminErr).toBeNull()

    const v2 = await createVehicle('Staff-Write Van')
    const staffC = await userClient(staff.email, staff.password)
    const { error: staffErr } = await staffC.from('event_vehicles')
      .insert({ vehicle_id: v2, event_date: OTHER_DAY, eo_dive_id: diveId } as never)
    expect(staffErr).not.toBeNull()

    const diverC = await userClient(diver.email, diver.password)
    const { error: diverErr } = await diverC.from('event_vehicles')
      .insert({ vehicle_id: v2, event_date: OTHER_DAY, eo_dive_id: diveId } as never)
    expect(diverErr).not.toBeNull()
  })
})

describe('event_vehicles cascade', () => {
  it('deleting a vehicle removes its allocations', async () => {
    const v = await createVehicle('Doomed Van')
    const { data: row } = await admin.from('event_vehicles')
      .insert({ vehicle_id: v, event_date: DAY, eo_dive_id: diveId } as never).select('id').single()
    const id = (row as { id: string }).id

    await admin.from('vehicles').delete().eq('id', v)
    const { data } = await admin.from('event_vehicles').select('id').eq('id', id)
    expect(data?.length).toBe(0)
  })
})
