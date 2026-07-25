// Integration coverage for the notify_admins_ride_waitlist trigger
// (20260707010000). Runs against the live local Supabase stack.
//
// Contract: an INSERT/UPDATE on bookings that lands details.ride_waitlisted =
// true on a non-cancelled row fans an in-app 'ride_waitlist' notification out
// to every admin. Ordinary ride bookings and cancelled ones don't notify, and
// a booking already-waitlisted doesn't re-notify on a later update.
//
// The flag itself is computed by the DB (20260724010000), never taken from the
// client, so these scenarios are set up by seat CAPACITY. A car-less event means
// "capacity not configured" in FunDive and never waitlists, so the waitlist
// scenarios use a one-seat car that the first diver fills.
//
// One diver per scenario: the one-active-booking-per-user index forbids two
// non-cancelled bookings for the same diver on one event.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
const divers: TestUser[] = []
let diveId: string
let seatedDive: string | undefined
let vehicleId: string | undefined
let roomyVehicleId: string | undefined
const cleanupBookings: string[] = []

async function insertBooking(
  userId: string, details: Record<string, unknown>, status = 'pending', eventId = diveId,
): Promise<string> {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: eventId, details, status,
  } as never).select('id').single()
  if (error) throw new Error(`insertBooking: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupBookings.push(id)
  return id
}

async function adminNotes() {
  const { data, error } = await admin.from('notifications')
    .select('*').eq('user_id', adminUser.id).eq('kind', 'ride_waitlist')
  if (error) throw new Error(`adminNotes: ${error.message}`)
  return data ?? []
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  for (let i = 0; i < 5; i++) divers.push(await createTestUser(admin, { role: 'diver' }))
  diveId = await createTestDive(admin)
  // One seat, so the first ride booking fills it and every later one is a
  // genuine waitlist request.
  const veh = await admin.from('vehicles')
    .insert({ name: 'Waitlist trigger test car', passenger_seats: 1 } as never)
    .select('id').single()
  if (veh.error) throw new Error(veh.error.message)
  vehicleId = (veh.data as { id: string }).id
  const alloc = await admin.from('event_vehicles')
    .insert({ vehicle_id: vehicleId, event_id: diveId } as never)
  if (alloc.error) throw new Error(alloc.error.message)
  // divers[4] takes the only seat; they are an ordinary booking, not a waitlist.
  await insertBooking(divers[4].id, { transportation: true })
})

afterAll(async () => {
  if (cleanupBookings.length) await admin.from('bookings').delete().in('id', cleanupBookings)
  if (seatedDive) {
    await admin.from('notifications').delete().eq('kind', 'ride_waitlist').eq('event_id', seatedDive)
    await deleteTestDive(admin, seatedDive)
  }
  for (const id of [vehicleId, roomyVehicleId]) if (id) await admin.from('vehicles').delete().eq('id', id)
  // Scoped to this test's event so no other run's rows are touched. (event_id
  // is text in notifications; the trigger stores the event uuid as text.)
  await admin.from('notifications').delete().eq('kind', 'ride_waitlist').eq('event_id', diveId)
  if (diveId) await deleteTestDive(admin, diveId)
  for (const u of [adminUser, ...divers]) if (u) await deleteTestUser(admin, u.id)
})

describe('notify_admins_ride_waitlist', () => {
  it('notifies the admin when a booking is a ride-waitlist request', async () => {
    await insertBooking(divers[0].id, { transportation: true, ride_waitlisted: true })
    const notes = await adminNotes()
    expect(notes.length).toBe(1)
    expect(notes[0].title).toMatch(/ride waitlist/i)
    expect(notes[0].url).toBe('/admin/logistics')
    expect(notes[0].event_id).toBe(diveId)
  })

  it('does not notify for an ordinary ride booking — the run has a free seat', async () => {
    seatedDive = await createTestDive(admin)
    const roomy = await admin.from('vehicles')
      .insert({ name: 'Waitlist trigger roomy car', passenger_seats: 4 } as never)
      .select('id').single()
    if (roomy.error) throw new Error(roomy.error.message)
    roomyVehicleId = (roomy.data as { id: string }).id
    const alloc = await admin.from('event_vehicles')
      .insert({ vehicle_id: roomyVehicleId, event_id: seatedDive } as never)
    if (alloc.error) throw new Error(alloc.error.message)

    const before = (await adminNotes()).length
    const id = await insertBooking(divers[1].id, { transportation: true }, 'pending', seatedDive)
    const { data } = await admin.from('bookings').select('details').eq('id', id).single()
    expect((data as { details: Record<string, unknown> }).details.ride_waitlisted).toBe(false)
    expect((await adminNotes()).length).toBe(before)
  })

  it('does not notify for a cancelled ride-waitlist booking', async () => {
    const before = (await adminNotes()).length
    await insertBooking(divers[2].id, { transportation: true, ride_waitlisted: true }, 'cancelled')
    expect((await adminNotes()).length).toBe(before)
  })

  it('does not re-notify when an already-waitlisted booking is updated again', async () => {
    const id = await insertBooking(divers[3].id, { transportation: true, ride_waitlisted: true })
    const after1 = (await adminNotes()).length
    const { error } = await admin.from('bookings')
      .update({ notes: 'touched' } as never).eq('id', id)
    if (error) throw new Error(error.message)
    expect((await adminNotes()).length).toBe(after1)
  })
})
