import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser,
  createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
  type TestUser,
} from './helpers'

const admin = adminClient()
let user: TestUser
let diveId: string
let courseId: string
const bookingIds: string[] = []

beforeAll(async () => {
  user = await createTestUser(admin)
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  if (bookingIds.length) await admin.from('bookings').delete().in('id', bookingIds)
  await admin.from('bookings').delete().eq('user_id', user.id)
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  if (user) await deleteTestUser(admin, user.id).catch(() => {})
})

describe('bookings.details JSONB', () => {
  it('defaults to an empty object on insert', async () => {
    const freshDive = await createTestDive(admin)
    const { data, error } = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: freshDive, status: 'pending' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.details).toEqual({})
    if (data) bookingIds.push(data.id)
    await admin.from('bookings').delete().eq('id', data!.id)
    await deleteTestDive(admin, freshDive)
  })

  it('rejects non-object JSON (array, scalar)', async () => {
    for (const bad of [[], 'string', 42, true] as unknown[]) {
      const { error } = await admin
        .from('bookings')
        .insert({
          user_id: user.id,
          event_id: diveId,
          status: 'pending',
          // @ts-expect-error — testing invalid shape
          details: bad,
        })
      expect(error, `expected rejection for details=${JSON.stringify(bad)}`).toBeTruthy()
    }
  })

  it('round-trips a populated details payload', async () => {
    const payload = {
      gear: { rent: true, mode: 'full', items: ['BCD', 'Regulator', 'Wetsuit'] },
      room: { option_id: 'eo_room_xyz', notes: 'twin share' },
      add_ons: ['nitrox_fills', 'go_pro_rental'],
      transportation: true,
      payment_method: 'bank_transfer',
      total: 15000,
      deposit: 6000,
    }
    const freshDive = await createTestDive(admin)
    const { data, error } = await admin
      .from('bookings')
      .insert({
        user_id: user.id,
        event_id: freshDive,
        status: 'confirmed',
        details: payload,
      })
      .select().single()
    expect(error).toBeNull()
    expect(data!.details).toEqual(payload)
    if (data) bookingIds.push(data.id)
    await admin.from('bookings').delete().eq('id', data!.id)
    await deleteTestDive(admin, freshDive)
  })
})

describe('bookings constraints', () => {
  it('requires event_id (event_present NOT NULL check)', async () => {
    // No event_id → rejected. Post-unification there is a single event_id
    // column (NOT NULL) instead of the old eo_dive_id/eo_course_id XOR.
    const neither = await admin
      .from('bookings')
      .insert({ user_id: user.id, status: 'pending' })
    expect(neither.error).toBeTruthy()
    expect(String(neither.error?.message ?? '')).toMatch(/event_present|event_id|null|check/i)
  })

  it('accepts a dive booking', async () => {
    const { data, error } = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: diveId, status: 'pending' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.event_id).toBe(diveId)
    if (data) bookingIds.push(data.id)
  })

  it('accepts a course booking', async () => {
    const { data, error } = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: courseId, status: 'pending' })
      .select().single()
    expect(error).toBeNull()
    expect(data!.event_id).toBe(courseId)
    if (data) bookingIds.push(data.id)
  })

  it('rejects a duplicate (user, event) booking', async () => {
    // The partial unique index fires only for a second booking from the same
    // user against the same event.
    const dup = await admin
      .from('bookings')
      .insert({ user_id: user.id, event_id: diveId, status: 'pending' })
    expect(dup.error).toBeTruthy()
    expect(String(dup.error?.message ?? '')).toMatch(/duplicate|unique/i)
  })

  it('rejects an invalid status', async () => {
    const { error } = await admin
      .from('bookings')
      // @ts-expect-error — intentionally bad status
      .insert({ user_id: user.id, event_id: diveId, status: 'made-up' })
    expect(error).toBeTruthy()
  })

  it('rejects a non-existent event_id (FK)', async () => {
    const { error } = await admin
      .from('bookings')
      // Valid uuid format, but no row with this id exists.
      .insert({ user_id: user.id, event_id: '00000000-0000-0000-0000-000000000001', status: 'pending' })
    expect(error).toBeTruthy()
    expect(String(error?.message ?? '')).toMatch(/foreign|violat/i)
  })

  it('rejects a non-existent user (FK)', async () => {
    const { error } = await admin.from('bookings').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      event_id: diveId,
      status: 'pending',
    })
    expect(error).toBeTruthy()
  })
})

describe('profiles constraints', () => {
  it('role CHECK rejects anything outside (diver, admin, staff)', async () => {
    for (const bad of ['customer', 'hacker', '']) {
      const { error } = await admin
        .from('profiles')
        // @ts-expect-error — intentionally bad role
        .update({ role: bad })
        .eq('id', user.id)
      expect(error, `expected rejection for role=${JSON.stringify(bad)}`).toBeTruthy()
    }
  })

  it('accepts role=diver, role=admin, and role=staff', async () => {
    for (const good of ['diver', 'admin', 'staff'] as const) {
      const { error } = await admin
        .from('profiles')
        .update({ role: good })
        .eq('id', user.id)
      expect(error).toBeNull()
    }
  })

  it('logged_dives CHECK rejects negative values', async () => {
    const { error } = await admin
      .from('profiles')
      .update({ logged_dives: -5 })
      .eq('id', user.id)
    expect(error).toBeTruthy()
  })

  it('contact_method CHECK rejects values outside the enum', async () => {
    const { error } = await admin
      .from('profiles')
      // @ts-expect-error: invalid enum value is the point of the test
      .update({ contact_method: 'carrier-pigeon' })
      .eq('id', user.id)
    expect(error).toBeTruthy()
  })

  it('accepts all documented contact_method values', async () => {
    for (const m of ['whatsapp', 'line', 'phone', 'email'] as const) {
      const { error } = await admin
        .from('profiles')
        .update({ contact_method: m })
        .eq('id', user.id)
      expect(error).toBeNull()
    }
  })

  it('round-trips the new diver fields', async () => {
    const { error } = await admin
      .from('profiles')
      .update({
        height_cm: 175.5,
        weight_kg: 70.2,
        shoe_size: 'EU 42',
        gender: 'female',
        contact_method: 'line',
        contact_id: 'alice-line',
        nitrox_certified: true,
        logged_dives: 42,
        last_dive_date: '2026-04-01',
      })
      .eq('id', user.id)
    expect(error).toBeNull()

    const { data } = await admin.from('profiles').select('*').eq('id', user.id).single()
    expect(data!.height_cm).toBe(175.5)
    expect(data!.weight_kg).toBe(70.2)
    expect(data!.shoe_size).toBe('EU 42')
    expect(data!.gender).toBe('female')
    expect(data!.contact_method).toBe('line')
    expect(data!.contact_id).toBe('alice-line')
    expect(data!.nitrox_certified).toBe(true)
    expect(data!.logged_dives).toBe(42)
    expect(data!.last_dive_date).toBe('2026-04-01')
  })
})

describe('payments constraints', () => {
  it('payments.status CHECK rejects invalid status', async () => {
    const { error } = await admin
      .from('payments')
      .insert({
        user_id: user.id,
        amount: 100,
        // @ts-expect-error: invalid enum value is the point of the test
        status: 'wild-west',
      })
    expect(error).toBeTruthy()
  })
})
