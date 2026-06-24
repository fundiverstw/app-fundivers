// Integration coverage for the `vehicles` fleet catalog (RLS + the
// passenger-seats CHECK). Runs against the live local Supabase stack.
//
// Contract (20260624000000_vehicles.sql):
//   - staff + admin can READ the fleet (logistics is staff-accessible)
//   - only admins can INSERT / UPDATE / DELETE
//   - divers and anon see nothing and cannot write
//   - passenger_seats must be >= 1
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let staff: TestUser
let diver: TestUser
const cleanupUsers: string[] = []
const cleanupVehicles: string[] = []

async function createVehicle(overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from('vehicles').insert({
    name: 'Delica', passenger_seats: 7, ...overrides,
  } as never).select('id').single()
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
})

afterAll(async () => {
  for (const id of cleanupVehicles) await admin.from('vehicles').delete().eq('id', id)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('vehicles RLS', () => {
  it('lets staff and admin read the fleet, but not anon or divers', async () => {
    const id = await createVehicle({ name: 'Veryca', passenger_seats: 1 })

    const staffC = await userClient(staff.email, staff.password)
    const { data: staffRows, error: staffErr } = await staffC.from('vehicles').select('*').eq('id', id)
    expect(staffErr).toBeNull()
    expect(staffRows?.length).toBe(1)

    const adminC = await userClient(adminUser.email, adminUser.password)
    const { data: adminRows } = await adminC.from('vehicles').select('*').eq('id', id)
    expect(adminRows?.length).toBe(1)

    // RLS filters rows rather than erroring — a diver / anon just sees none.
    const diverC = await userClient(diver.email, diver.password)
    const { data: diverRows } = await diverC.from('vehicles').select('*').eq('id', id)
    expect(diverRows?.length).toBe(0)

    const { data: anonRows } = await anonClient().from('vehicles').select('*').eq('id', id)
    expect(anonRows?.length).toBe(0)
  })

  it('only admins can write; staff and divers are blocked', async () => {
    const adminC = await userClient(adminUser.email, adminUser.password)
    const { data: created, error: adminErr } = await adminC
      .from('vehicles').insert({ name: "Sigi's Car", passenger_seats: 4 } as never).select('id').single()
    expect(adminErr).toBeNull()
    cleanupVehicles.push((created as { id: string }).id)

    const staffC = await userClient(staff.email, staff.password)
    const { error: staffErr } = await staffC
      .from('vehicles').insert({ name: 'Staff Van', passenger_seats: 5 } as never)
    expect(staffErr).not.toBeNull()

    const diverC = await userClient(diver.email, diver.password)
    const { error: diverErr } = await diverC
      .from('vehicles').insert({ name: 'Diver Van', passenger_seats: 5 } as never)
    expect(diverErr).not.toBeNull()
  })

  it('rejects a vehicle with fewer than one passenger seat', async () => {
    const { error } = await admin.from('vehicles').insert({ name: 'No Seats', passenger_seats: 0 } as never)
    expect(error).not.toBeNull()
  })
})
