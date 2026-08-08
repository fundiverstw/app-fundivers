// Integration tests for create_course_continuation — the one path that puts a
// diver on a second scheduled course to finish a course they started on an
// earlier one (20260814000000). What we lock in:
//   1. An admin can create the pairing: a zero-cost confirmed booking on the
//      second course, pointing at the booking that holds the money, limited to
//      the days chosen.
//   2. Gear carries over from the original; money does not.
//   3. The optional trim narrows the original booking's attend_days.
//   4. Every rule that makes the pairing valid is enforced here, not just in
//      the SPA: days must belong to the target course, the diver may not
//      already be booked on it, a dive is not a course, a continuation cannot
//      itself be continued, and a non-admin cannot call it at all.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
const cleanupUsers: string[] = []
const cleanupEvents: string[] = []

const JUNE = ['2026-06-06', '2026-06-07']
const JULY = ['2026-07-04', '2026-07-05']

async function makeCourse(days: string[]): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('events' as never).insert({
    id, kind: 'course', display_title: 'OW test', start_time: '09:00:00', course_days: days,
  } as never)
  if (error) throw new Error(`makeCourse failed: ${error.message}`)
  cleanupEvents.push(id)
  return id
}

async function makeBooking(userId: string, eventId: string, details: Record<string, unknown> = { total: 12000 }) {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId, event_id: eventId, status: 'confirmed', details,
  } as never).select('id').single()
  if (error) throw new Error(`makeBooking failed: ${error.message}`)
  return (data as { id: string }).id
}

function bookingRow(id: string) {
  return admin.from('bookings').select('*').eq('id', id).single()
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, diver.id)
})

afterAll(async () => {
  for (const id of cleanupEvents) await admin.from('events' as never).delete().eq('id', id)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('create_course_continuation', () => {
  it('creates a zero-cost booking on the second course, limited to the days chosen', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const source = await makeBooking(diver.id, june, {
      total: 12000, deposit: 4000, gear: { rent: true, items: ['wetsuit'] },
    })

    const api = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await api.rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: ['2026-07-05'],
    })
    expect(error).toBeNull()

    const { data: row } = await bookingRow(data as string)
    expect(row!.user_id).toBe(diver.id)
    expect(row!.event_id).toBe(july)
    expect(row!.status).toBe('confirmed')
    expect(row!.continues_booking_id).toBe(source)
    expect(row!.attend_days).toEqual(['2026-07-05'])

    // Nothing is owed on the continuation, and the breakdown says so with one
    // stated line rather than an empty snapshot the app would recompute.
    const details = row!.details as Record<string, unknown>
    expect(details.total).toBe(0)
    expect(details.deposit).toBe(0)
    expect(details.course_continuation).toBe(true)
    expect(details.charges).toHaveLength(1)
    expect((details.charges as Array<{ amount: number }>)[0].amount).toBe(0)
    // Gear carries over — same student, same wetsuit, different days.
    expect(details.gear).toMatchObject({ rent: true, items: ['wetsuit'] })

    // The original is untouched: it still holds the money and all its days.
    const { data: original } = await bookingRow(source)
    expect(original!.attend_days).toBeNull()
    expect((original!.details as Record<string, unknown>).total).toBe(12000)
  })

  it('trims the original booking to the days actually attended when asked', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const source = await makeBooking(diver.id, june)

    const api = await userClient(adminUser.email, adminUser.password)
    const { error } = await api.rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: JULY, p_source_days: ['2026-06-06'],
    })
    expect(error).toBeNull()

    const { data: original } = await bookingRow(source)
    expect(original!.attend_days).toEqual(['2026-06-06'])
  })

  it('refuses a day the target course does not run on', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const source = await makeBooking(diver.id, june)

    const api = await userClient(adminUser.email, adminUser.password)
    const { error } = await api.rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: ['2026-08-01'],
    })
    expect(error?.message).toMatch(/day that course runs on/i)
  })

  it('refuses an empty day list', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const source = await makeBooking(diver.id, june)

    const api = await userClient(adminUser.email, adminUser.password)
    const { error } = await api.rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: [],
    })
    expect(error?.message).toMatch(/at least one day/i)
  })

  // The duplicate-sale mistake this feature exists to prevent.
  it('refuses to continue onto a course the diver is already booked on', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const source = await makeBooking(diver.id, june)
    await makeBooking(diver.id, july)

    const api = await userClient(adminUser.email, adminUser.password)
    const { error } = await api.rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: JULY,
    })
    expect(error?.message).toMatch(/already booked/i)
  })

  it('refuses a dive on either end', async () => {
    const dive = await createTestDive(admin)
    cleanupEvents.push(dive)
    const june = await makeCourse(JUNE)
    const diveBooking = await makeBooking(diver.id, dive)
    const courseBooking = await makeBooking(diver.id, june)

    const api = await userClient(adminUser.email, adminUser.password)
    const fromDive = await api.rpc('create_course_continuation', {
      p_source_booking: diveBooking, p_event_id: june, p_days: JUNE,
    })
    expect(fromDive.error?.message).toMatch(/only a course booking/i)

    const ontoDive = await api.rpc('create_course_continuation', {
      p_source_booking: courseBooking, p_event_id: dive, p_days: JUNE,
    })
    expect(ontoDive.error?.message).toMatch(/continued on another course/i)
    await deleteTestDive(admin, dive)
  })

  // A chain would turn "where is the money?" into a walk instead of a lookup.
  it('refuses to continue a continuation', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const august = await makeCourse(['2026-08-08'])
    const source = await makeBooking(diver.id, june)

    const api = await userClient(adminUser.email, adminUser.password)
    const { data: second } = await api.rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: JULY,
    })
    const { error } = await api.rpc('create_course_continuation', {
      p_source_booking: second as string, p_event_id: august, p_days: ['2026-08-08'],
    })
    expect(error?.message).toMatch(/itself a continuation/i)
  })

  it('is not callable at all without a session', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const source = await makeBooking(diver.id, june)

    const { error } = await anonClient().rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: JULY,
    })
    expect(error).not.toBeNull()
  })

  it('refuses a non-admin caller', async () => {
    const june = await makeCourse(JUNE)
    const july = await makeCourse(JULY)
    const source = await makeBooking(diver.id, june)

    const api = await userClient(diver.email, diver.password)
    const { error } = await api.rpc('create_course_continuation', {
      p_source_booking: source, p_event_id: july, p_days: JULY,
    })
    expect(error?.message).toMatch(/only an admin/i)

    // And nothing was written on the way to being refused.
    const { data: rows } = await admin.from('bookings').select('id').eq('event_id', july)
    expect(rows).toHaveLength(0)
  })
})
