// Integration coverage for the event_ride_seats RPC (20260628000000).
// Runs against the live local Supabase stack.
//
// Contract:
//   - capacity = sum of passenger_seats over the DISTINCT vehicles assigned to
//     the event (a van on several days of a multi-day event counts once)
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
const cleanupVehicles: string[] = []
const cleanupBookings: string[] = []

async function createVehicle(name: string, seats: number): Promise<string> {
  const { data, error } = await admin.from('vehicles')
    .insert({ name, passenger_seats: seats } as never).select('id').single()
  if (error) throw new Error(`createVehicle: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupVehicles.push(id)
  return id
}

async function allocate(vehicleId: string, date: string): Promise<void> {
  const { error } = await admin.from('event_vehicles')
    .insert({ vehicle_id: vehicleId, event_date: date, eo_dive_id: diveId } as never)
  if (error) throw new Error(`allocate: ${error.message}`)
}

async function book(userId: string, transportation: boolean, status = 'pending'): Promise<void> {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, eo_dive_id: diveId, eo_course_id: null,
    details: { transportation }, status,
  } as never).select('id').single()
  if (error) throw new Error(`book: ${error.message}`)
  cleanupBookings.push((data as { id: string }).id)
}

async function seats(client = admin): Promise<{ capacity: number; claimed: number }> {
  const { data, error } = await client.rpc('event_ride_seats', { p_dive_id: diveId, p_course_id: null })
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
  for (const id of cleanupVehicles) await admin.from('vehicles').delete().eq('id', id)
  if (diveId) await deleteTestDive(admin, diveId)
  for (const u of [diverA, diverB, diverC]) if (u) await deleteTestUser(admin, u.id)
})

describe('event_ride_seats', () => {
  it('reports 0/0 with no cars and no ride claims', async () => {
    expect(await seats()).toEqual({ capacity: 0, claimed: 0 })
  })

  it('sums passenger seats over assigned vehicles for capacity', async () => {
    await allocate(await createVehicle('Delica', 7), '2031-05-01')
    await allocate(await createVehicle('Veryca', 4), '2031-05-01')
    expect((await seats()).capacity).toBe(11)
  })

  it('counts a van assigned to several days of the event only once', async () => {
    const bus = await createVehicle('Bus', 12)
    await allocate(bus, '2031-05-02')
    await allocate(bus, '2031-05-03') // same van, another day → still +12, not +24
    // 7 + 4 (from previous test) + 12 = 23
    expect((await seats()).capacity).toBe(23)
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
    expect(asDiver.capacity).toBe(23)
    expect(asDiver.claimed).toBe(1)
  })
})
