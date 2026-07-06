// Integration coverage for the event_ride_seats RPC (20260628000000, capacity
// clause superseded by 20260705000000). Runs against the live local stack.
//
// Contract:
//   - capacity = sum of passenger_seats over the DISTINCT vehicles assigned to
//     the event, MINUS one seat per vehicle reserved for whoever drives it
//     (a van on several days of a multi-day event counts once)
//   - claimed  = non-cancelled bookings with details.transportation = true
//   - callable by a plain diver (SECURITY DEFINER bypasses the event_vehicles /
//     bookings RLS that would otherwise hide the inputs)
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let diverA: TestUser
let diverB: TestUser
let diverC: TestUser
let diveId: string
let staffDive: string | undefined
const cleanupVehicles: string[] = []
const cleanupBookings: string[] = []
const cleanupUsers: TestUser[] = []

async function createVehicle(name: string, seats: number): Promise<string> {
  const { data, error } = await admin.from('vehicles')
    .insert({ name, passenger_seats: seats } as never).select('id').single()
  if (error) throw new Error(`createVehicle: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupVehicles.push(id)
  return id
}

async function allocate(vehicleId: string): Promise<void> {
  const { error } = await admin.from('event_vehicles')
    .insert({ vehicle_id: vehicleId, event_id: diveId } as never)
  if (error) throw new Error(`allocate: ${error.message}`)
}

async function book(userId: string, transportation: boolean, status = 'pending'): Promise<void> {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: diveId,
    details: { transportation }, status,
  } as never).select('id').single()
  if (error) throw new Error(`book: ${error.message}`)
  cleanupBookings.push((data as { id: string }).id)
}

async function seats(client = admin): Promise<{ capacity: number; claimed: number }> {
  const { data, error } = await client.rpc('event_ride_seats', { p_event_id: diveId })
  if (error) throw new Error(`rpc: ${error.message}`)
  return (data as { capacity: number; claimed: number }[])[0]
}

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
  diverC = await createTestUser(admin, { role: 'diver' })
  diveId = await createTestDive(admin)
})

afterAll(async () => {
  if (cleanupBookings.length) await admin.from('bookings').delete().in('id', cleanupBookings)
  // Delete the staff-test dive first — cascades its event_vehicles + duties so
  // the shared vehicle cleanup below isn't blocked by a lingering allocation.
  if (staffDive) await deleteTestDive(admin, staffDive)
  for (const id of cleanupVehicles) await admin.from('vehicles').delete().eq('id', id)
  if (diveId) await deleteTestDive(admin, diveId)
  for (const u of [diverA, diverB, diverC, ...cleanupUsers]) if (u) await deleteTestUser(admin, u.id)
})

describe('event_ride_seats', () => {
  it('reports 0/0 with no cars and no ride claims', async () => {
    expect(await seats()).toEqual({ capacity: 0, claimed: 0 })
  })

  it('sums passenger seats over assigned vehicles, reserving one driver seat each', async () => {
    await allocate(await createVehicle('Delica', 7))
    await allocate(await createVehicle('Veryca', 4))
    // (7 - 1) + (4 - 1) = 9 rideable seats after the two drivers.
    expect((await seats()).capacity).toBe(9)
  })

  it('counts a van assigned to the event once and rejects a duplicate', async () => {
    const bus = await createVehicle('Bus', 12)
    await allocate(bus)
    // Same van on the same event again → blocked by the unique index, so the
    // seat total can't be inflated by a duplicate row.
    const dup = await admin.from('event_vehicles')
      .insert({ vehicle_id: bus, event_id: diveId } as never)
    expect(dup.error).not.toBeNull()
    // (7 + 4 + 12) physical − 3 drivers = 20 rideable seats.
    expect((await seats()).capacity).toBe(20)
  })

  it('counts only non-cancelled transportation=true bookings as claimed', async () => {
    await book(diverA.id, true)             // claims a ride
    await book(diverB.id, false)            // self-transport
    await book(diverC.id, true, 'cancelled')// cancelled → excluded
    expect((await seats()).claimed).toBe(1)
  })

  it('is callable by a plain diver (RLS bypass) and returns the same numbers', async () => {
    const diverClient = await userClient(diverA.email, diverA.password)
    const asDiver = await seats(diverClient)
    const asAdmin = await seats(admin)
    expect(asDiver).toEqual(asAdmin)
    expect(asDiver.capacity).toBe(20)
    expect(asDiver.claimed).toBe(1)
  })

  it('reserves the full on-duty staff count when staff outnumber the vehicles', async () => {
    // Isolated dive: one 8-seat van but three on-duty staff, all of whom ride.
    staffDive = await createTestDive(admin)
    const van = await createVehicle('Hiace', 8)
    const va = await admin.from('event_vehicles')
      .insert({ vehicle_id: van, event_id: staffDive } as never)
    if (va.error) throw new Error(`allocate: ${va.error.message}`)
    for (let i = 0; i < 3; i++) {
      const st = await createTestUser(admin, { role: 'staff' })
      cleanupUsers.push(st)
      const du = await admin.from('duties')
        .insert({ assignee_id: st.id, role: 'guide', start_date: '2030-06-01', event_id: staffDive } as never)
      if (du.error) throw new Error(`duty: ${du.error.message}`)
    }
    const { data, error } = await admin.rpc('event_ride_seats', { p_event_id: staffDive })
    if (error) throw new Error(`rpc: ${error.message}`)
    // 8 physical seats − max(1 van, 3 staff) = 8 − 3 = 5 rideable for divers.
    expect((data as { capacity: number }[])[0].capacity).toBe(5)
  })
})
