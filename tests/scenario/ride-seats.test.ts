import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'

// Filling a van.
//
// Seats are counted per RUN — the events grouped together for a day's shared
// transport — not per event, and the on-duty staff ride in them. So the number a
// diver can actually sit in moves as the shop allocates cars, groups dives, and
// rosters guides, and the "you're on the transport waitlist" flag is stamped by
// the database rather than chosen by the browser. That is the whole reason to
// walk it: the answer depends on the order things happened.

let w: World
const l: Ledger = ledger()

beforeAll(async () => { w = await world(l) })
afterAll(async () => { await teardownWorld(l) })

describe('scenario: divers fill the shop van', () => {
  it('seats them until it is full, then waitlists the next one', async () => {
    const eventId = await w.dive()
    const van = await w.vehicle(2)
    await w.allocateCar(van, eventId)

    expect(await w.rideSeats(eventId)).toMatchObject({ seats: 2, staff: 0, capacity: 2, claimed: 0 })

    const first = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(first.waitlisted).toBe(false)
    const second = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(second.waitlisted).toBe(false)
    expect(await w.rideSeats(eventId)).toMatchObject({ capacity: 2, claimed: 2 })

    // Third diver: the van is full, and the DB says so.
    const third = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(third.waitlisted).toBe(true)
  })

  // Reads as surprising, and is deliberate (20260725000000): a run with no
  // rideable seat means the shop has not planned transport YET, not that the
  // ride is full. Flagging it would page admins to "add a car" for an event that
  // has none, so bookings are taken and the van is arranged later. canRequestRide
  // agrees on the client side.
  it('takes ride requests unflagged when no car is allocated yet', async () => {
    const eventId = await w.dive()
    expect(await w.rideSeats(eventId)).toMatchObject({ seats: 0, capacity: 0 })

    const only = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(only.waitlisted).toBe(false)

    // Once a car IS on the event, the run is finite again and the maths applies.
    await w.allocateCar(await w.vehicle(1), eventId)
    const next = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(next.waitlisted).toBe(true)
  })

  it('adding a second car frees the next diver', async () => {
    const eventId = await w.dive()
    await w.allocateCar(await w.vehicle(1), eventId)

    const seated = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(seated.waitlisted).toBe(false)

    const waiting = await w.person('diver')
    const bookingId = await w.book({ diver: waiting, eventId, status: 'pending' })
    expect(await w.requestRide(bookingId)).toBe(true)

    // The shop puts a second van on. Asking again now gets a seat — the flag is
    // recomputed on each write, not cached from the first refusal.
    await w.allocateCar(await w.vehicle(3), eventId)
    expect(await w.rideSeats(eventId)).toMatchObject({ seats: 4, capacity: 4 })
    expect(await w.requestRide(bookingId)).toBe(false)
  })

  it('a diver who is not asking for a ride never takes a seat', async () => {
    const eventId = await w.dive()
    await w.allocateCar(await w.vehicle(1), eventId)

    // Self-transport: books fine and claims nothing.
    const own = await w.book({ diver: await w.person('diver'), eventId, status: 'pending' })
    expect(own).toBeTruthy()
    expect(await w.rideSeats(eventId)).toMatchObject({ claimed: 0, capacity: 1 })

    const rider = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(rider.waitlisted).toBe(false)
  })
})

describe('scenario: the guides ride in the same van', () => {
  it('rostering a guide takes a seat away from the divers', async () => {
    const eventId = await w.dive({}, 9)
    await w.allocateCar(await w.vehicle(2), eventId)
    expect(await w.rideSeats(eventId)).toMatchObject({ seats: 2, staff: 0, capacity: 2 })

    const guide = await w.person('staff')
    expect(await w.assignDuty({ who: guide, eventId, inDays: 9 })).toBeNull()

    // No extra seat is reserved for a driver: the guide simply occupies one.
    expect(await w.rideSeats(eventId)).toMatchObject({ seats: 2, staff: 1, capacity: 1 })

    const seated = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(seated.waitlisted).toBe(false)
    const bumped = await w.bookWithRide({ diver: await w.person('diver'), eventId })
    expect(bumped.waitlisted).toBe(true)
  })
})

describe('scenario: two dives share one van for the day', () => {
  it('counts the van once across the run, not once per dive', async () => {
    const morning = await w.dive({}, 11)
    const afternoon = await w.dive({}, 11)
    const van = await w.vehicle(2)
    // The same physical van on both dives.
    await w.allocateCar(van, morning)
    await w.allocateCar(van, afternoon)
    await w.shareTransport([morning, afternoon], 11)

    // Two seats for the whole run — not two per dive.
    expect(await w.rideSeats(morning)).toMatchObject({ seats: 2, capacity: 2 })
    expect(await w.rideSeats(afternoon)).toMatchObject({ seats: 2, capacity: 2 })

    const a = await w.bookWithRide({ diver: await w.person('diver'), eventId: morning })
    const b = await w.bookWithRide({ diver: await w.person('diver'), eventId: afternoon })
    expect([a.waitlisted, b.waitlisted]).toEqual([false, false])

    // The run is full, so a third diver on EITHER dive waits.
    const c = await w.bookWithRide({ diver: await w.person('diver'), eventId: morning })
    expect(c.waitlisted).toBe(true)
  })

  it('does not waitlist a diver for a seat they already hold on the run', async () => {
    const first = await w.dive({}, 13)
    const second = await w.dive({}, 13)
    const van = await w.vehicle(1)
    await w.allocateCar(van, first)
    await w.allocateCar(van, second)
    await w.shareTransport([first, second], 13)

    const diver = await w.person('diver')
    const onFirst = await w.bookWithRide({ diver, eventId: first })
    expect(onFirst.waitlisted).toBe(false)

    // Same diver, second dive of the same run: the only seat taken is their own,
    // so asking for a ride must not put them behind themselves.
    const ownSecond = await w.book({ diver, eventId: second, status: 'pending' })
    expect(await w.requestRide(ownSecond)).toBe(false)

    // Someone with no claim on the run really is out of seats.
    const newcomer = await w.bookWithRide({ diver: await w.person('diver'), eventId: second })
    expect(newcomer.waitlisted).toBe(true)
  })
})
