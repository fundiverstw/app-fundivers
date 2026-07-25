// The DB owns `details.ride_waitlisted` (20260724010000). Runs against the live
// local stack.
//
// Contract:
//   - a ride requested on a run with a free seat  → ride_waitlisted = false,
//     whatever the client sent
//   - a ride requested with no free seat          → ride_waitlisted = true,
//     whatever the client sent (and admins are notified by the existing trigger)
//   - no ride requested                           → the flag is stripped, so it
//     can never notify admins about a ride nobody asked for
//   - a diver's own claim never waitlists them: the seat they already hold on
//     the run is theirs
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()

let diverA: TestUser
let diverB: TestUser
let diverC: TestUser
let diveId: string
let partnerId: string
let vehicleId: string
const cleanupBookings: string[] = []

async function book(
  userId: string, details: Record<string, unknown>, eventId = diveId,
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.from('bookings')
    .insert({ user_id: userId, event_id: eventId, details, status: 'pending' } as never)
    .select('id, details').single()
  if (error) throw new Error(`book: ${error.message}`)
  const row = data as { id: string; details: Record<string, unknown> }
  cleanupBookings.push(row.id)
  return row.details
}

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
  diverC = await createTestUser(admin, { role: 'diver' })
  diveId = await createTestDive(admin)
  partnerId = await createTestDive(admin)
  const { data, error } = await admin.from('vehicles')
    .insert({ name: 'Waitlist test car', passenger_seats: 2 } as never).select('id').single()
  if (error) throw new Error(`vehicle: ${error.message}`)
  vehicleId = (data as { id: string }).id
  const alloc = await admin.from('event_vehicles')
    .insert({ vehicle_id: vehicleId, event_id: diveId } as never)
  if (alloc.error) throw new Error(`allocate: ${alloc.error.message}`)
})

afterAll(async () => {
  if (cleanupBookings.length) await admin.from('bookings').delete().in('id', cleanupBookings)
  for (const id of [diveId, partnerId]) if (id) await deleteTestDive(admin, id)
  if (vehicleId) await admin.from('vehicles').delete().eq('id', vehicleId)
  for (const u of [diverA, diverB, diverC]) if (u) await deleteTestUser(admin, u.id)
})

describe('bookings.details.ride_waitlisted is recomputed by the DB', () => {
  it('overrides a client claiming a seat exists — 2 seats, so the first two fit', async () => {
    // The client lies in the pessimistic direction; the DB corrects it down.
    const first = await book(diverA.id, { transportation: true, ride_waitlisted: true })
    expect(first.ride_waitlisted).toBe(false)
    const second = await book(diverB.id, { transportation: true })
    expect(second.ride_waitlisted).toBe(false)
  })

  it('waitlists the third diver even when the client says otherwise', async () => {
    const third = await book(diverC.id, { transportation: true, ride_waitlisted: false })
    expect(third.ride_waitlisted).toBe(true)
  })

  it('leaves a run with no car at all unflagged — capacity is not set up yet', async () => {
    // FunDive's default (canRequestRide at capacity 0) is to take the booking and
    // let the shop plan the van later, so this must not page the admins.
    const carless = await createTestDive(admin)
    const newcomer = await createTestUser(admin, { role: 'diver' })
    const details = await book(newcomer.id, { transportation: true }, carless)
    expect(details.ride_waitlisted).toBe(false)
    await admin.from('bookings').delete().eq('user_id', newcomer.id)
    await deleteTestUser(admin, newcomer.id)
    await deleteTestDive(admin, carless)
  })

  it('strips the flag when no ride was requested', async () => {
    const selfDriver = await book(diverA.id, {
      transportation: false, ride_waitlisted: true,
    }, partnerId)
    expect(selfDriver).not.toHaveProperty('ride_waitlisted')
  })

  it('does not waitlist a diver for a seat they already hold on the run', async () => {
    // Group the two dives into one run, then let diverA — who already rides on
    // the first — request a ride on the partner event. The run is full, but the
    // seat being counted against them is their own.
    const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const g = crypto.randomUUID()
    const ins = await admin.from('event_ride_groups').insert([
      { ride_day: day, event_id: diveId, group_id: g },
      { ride_day: day, event_id: partnerId, group_id: g },
    ] as never)
    if (ins.error) throw new Error(`group: ${ins.error.message}`)

    // diverA's self-transport booking on the partner event flips to a ride.
    const own = cleanupBookings.at(-1)!
    const { data, error } = await admin.from('bookings')
      .update({ details: { transportation: true } } as never)
      .eq('id', own).select('details').single()
    if (error) throw new Error(`update: ${error.message}`)
    expect((data as { details: Record<string, unknown> }).details.ride_waitlisted).toBe(false)

    // A diver with no claim on the run is waitlisted — the run really is full.
    const newcomer = await createTestUser(admin, { role: 'diver' })
    const theirs = await book(newcomer.id, { transportation: true }, partnerId)
    expect(theirs.ride_waitlisted).toBe(true)
    await admin.from('bookings').delete().eq('user_id', newcomer.id)
    await deleteTestUser(admin, newcomer.id)
  })

  it('does not let a diver hide a full run from the admins', async () => {
    // The notification trigger keys off the flag the DB just wrote, so the
    // "add a car" notice lands for the waitlisted diver regardless of intent.
    const { data } = await admin.from('notifications')
      .select('kind, body').eq('kind', 'ride_waitlist').order('created_at', { ascending: false }).limit(5)
    expect((data ?? []).length).toBeGreaterThan(0)
  })
})
