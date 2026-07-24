// Integration coverage for the event_ride_seats RPC (rewritten in
// 20260724000000_ride_groups_shared_transport). Runs against the live local stack.
//
// Contract:
//   - the unit is the RUN: the events grouped together in event_ride_groups for
//     a day, or the event alone when it isn't grouped
//   - seats    = passenger_seats over the DISTINCT vehicles on the run (a van on
//                two of the run's events counts once)
//   - staff    = distinct on-duty assignees on the run — they ride those seats,
//                and no extra seat is reserved for a driver
//   - capacity = max(0, seats - staff): what a diver can still sit in
//   - claimed  = distinct divers with a non-cancelled transportation=true
//                booking anywhere on the run
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
let partnerDive: string | undefined
const cleanupVehicles: string[] = []
const cleanupBookings: string[] = []
const cleanupUsers: TestUser[] = []

interface Seats { seats: number; staff: number; capacity: number; claimed: number }

async function createVehicle(name: string, seats: number): Promise<string> {
  const { data, error } = await admin.from('vehicles')
    .insert({ name, passenger_seats: seats } as never).select('id').single()
  if (error) throw new Error(`createVehicle: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupVehicles.push(id)
  return id
}

async function allocate(vehicleId: string, eventId = diveId): Promise<void> {
  const { error } = await admin.from('event_vehicles')
    .insert({ vehicle_id: vehicleId, event_id: eventId } as never)
  if (error) throw new Error(`allocate: ${error.message}`)
}

async function book(
  userId: string, transportation: boolean, status = 'pending', eventId = diveId,
): Promise<void> {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: eventId,
    details: { transportation }, status,
  } as never).select('id').single()
  if (error) throw new Error(`book: ${error.message}`)
  cleanupBookings.push((data as { id: string }).id)
}

async function rideSeats(eventId = diveId, client = admin): Promise<Seats> {
  const { data, error } = await client.rpc('event_ride_seats', { p_event_id: eventId })
  if (error) throw new Error(`rpc: ${error.message}`)
  return (data as Seats[])[0]
}

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
  diverC = await createTestUser(admin, { role: 'diver' })
  diveId = await createTestDive(admin)
})

afterAll(async () => {
  if (cleanupBookings.length) await admin.from('bookings').delete().in('id', cleanupBookings)
  // Delete the extra dives first — cascading their event_vehicles + duties so
  // the shared vehicle cleanup below isn't blocked by a lingering allocation.
  for (const id of [staffDive, partnerDive]) if (id) await deleteTestDive(admin, id)
  for (const id of cleanupVehicles) await admin.from('vehicles').delete().eq('id', id)
  if (diveId) await deleteTestDive(admin, diveId)
  for (const u of [diverA, diverB, diverC, ...cleanupUsers]) if (u) await deleteTestUser(admin, u.id)
})

describe('event_ride_seats', () => {
  it('reports all zeroes with no cars and no ride claims', async () => {
    expect(await rideSeats()).toEqual({ seats: 0, staff: 0, capacity: 0, claimed: 0 })
  })

  it('sums passenger seats over assigned vehicles with no driver seat reserved', async () => {
    await allocate(await createVehicle('Delica', 7))
    await allocate(await createVehicle('Veryca', 4))
    // Every physical seat is rideable — the app assigns nobody to a wheel.
    expect(await rideSeats()).toMatchObject({ seats: 11, staff: 0, capacity: 11 })
  })

  it('counts a van assigned to the event once and rejects a duplicate', async () => {
    const bus = await createVehicle('Bus', 12)
    await allocate(bus)
    // Same van on the same event again → blocked by the unique index, so the
    // seat total can't be inflated by a duplicate row.
    const dup = await admin.from('event_vehicles')
      .insert({ vehicle_id: bus, event_id: diveId } as never)
    expect(dup.error).not.toBeNull()
    expect((await rideSeats()).capacity).toBe(23)
  })

  it('counts only non-cancelled transportation=true bookings as claimed', async () => {
    await book(diverA.id, true)             // claims a ride
    await book(diverB.id, false)            // self-transport
    await book(diverC.id, true, 'cancelled')// cancelled → excluded
    expect((await rideSeats()).claimed).toBe(1)
  })

  it('is callable by a plain diver (RLS bypass) and returns the same numbers', async () => {
    const diverClient = await userClient(diverA.email, diverA.password)
    const asDiver = await rideSeats(diveId, diverClient)
    expect(asDiver).toEqual(await rideSeats())
    expect(asDiver.capacity).toBe(23)
    expect(asDiver.claimed).toBe(1)
  })

  it('takes a seat for every on-duty staff member, and no more', async () => {
    // Isolated dive: one 8-seat van, three on-duty staff who all ride it.
    staffDive = await createTestDive(admin)
    await allocate(await createVehicle('Hiace', 8), staffDive)
    for (let i = 0; i < 3; i++) {
      const st = await createTestUser(admin, { role: 'staff' })
      cleanupUsers.push(st)
      const du = await admin.from('duties')
        .insert({ assignee_id: st.id, role: 'guide', start_date: '2030-06-01', event_id: staffDive } as never)
      if (du.error) throw new Error(`duty: ${du.error.message}`)
    }
    // 8 physical seats − 3 staff = 5 left for divers.
    expect(await rideSeats(staffDive)).toMatchObject({ seats: 8, staff: 3, capacity: 5 })
  })

  it('pools a run: an event with no car of its own rides in its partner\'s van', async () => {
    partnerDive = await createTestDive(admin)
    const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    // Alone, the partner has nothing: no car, no seats.
    expect(await rideSeats(partnerDive)).toMatchObject({ seats: 0, capacity: 0 })

    const g = crypto.randomUUID()
    const ins = await admin.from('event_ride_groups').insert([
      { ride_day: day, event_id: diveId, group_id: g },
      { ride_day: day, event_id: partnerDive, group_id: g },
    ] as never)
    if (ins.error) throw new Error(`group: ${ins.error.message}`)

    // Now it sees the run's whole fleet (23 seats) and the run's claims: diverA
    // from the first dive, plus one of its own.
    await book(diverB.id, true, 'pending', partnerDive)
    const pooled = await rideSeats(partnerDive)
    expect(pooled).toMatchObject({ seats: 23, staff: 0, capacity: 23, claimed: 2 })
    // Both ends of the run agree — the same van is never counted twice.
    expect(await rideSeats(diveId)).toEqual(pooled)
  })

  it('ignores a grouping row for a day the event no longer runs on', async () => {
    // Rescheduling an event doesn't rewrite its grouping rows, so a row can be
    // left pointing at a day the event isn't on. It must not pool seats.
    const stray = await createTestDive(admin)
    const g = crypto.randomUUID()
    const ins = await admin.from('event_ride_groups').insert([
      { ride_day: '2031-01-01', event_id: stray, group_id: g },
      { ride_day: '2031-01-01', event_id: diveId, group_id: g },
    ] as never)
    if (ins.error) throw new Error(`group: ${ins.error.message}`)
    // The stray dive runs a week from now, not on 2031-01-01 — it stays alone.
    expect(await rideSeats(stray)).toMatchObject({ seats: 0, capacity: 0, claimed: 0 })
    await deleteTestDive(admin, stray)
  })

  it('counts a diver booked on both events of a run as one claim', async () => {
    // diverC rides on BOTH events of the run — one body, one seat. diverA and
    // diverB already hold one claim each, so the run's total goes to 3, not 4.
    await book(diverC.id, true, 'pending', partnerDive!)
    await book(diverC.id, true, 'pending')
    expect((await rideSeats(diveId)).claimed).toBe(3)
  })
})
