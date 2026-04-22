import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestUser, deleteTestUser,
  createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
  type TestUser,
} from './helpers'

const admin = adminClient()
let author: TestUser
let resolver: TestUser
let diveId: string
let courseId: string
let bookingId: string
const noteIds: string[] = []

beforeAll(async () => {
  author = await createTestUser(admin)
  resolver = await createTestUser(admin, { role: 'admin' })
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)

  // A booking that gear-map flags can attach to.
  const { data: b, error } = await admin
    .from('bookings')
    .insert({
      user_id: author.id,
      eo_dive_id: diveId,
      status: 'confirmed',
      details: { gear: { rent: true, mode: 'a-la-carte', items: ['Wetsuit'] } },
    })
    .select().single()
  if (error) throw error
  bookingId = b!.id
})

afterAll(async () => {
  if (noteIds.length) await admin.from('admin_notes').delete().in('id', noteIds)
  if (bookingId) await admin.from('bookings').delete().eq('id', bookingId)
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  for (const u of [author, resolver]) if (u) await deleteTestUser(admin, u.id).catch(() => {})
})

describe('admin_notes constraints', () => {
  it('XOR target — exactly one of dive/course/booking must be set', async () => {
    const none = await admin.from('admin_notes').insert({
      created_by: author.id, tag: 'note', content: 'x',
    })
    expect(none.error).toBeTruthy()

    const two = await admin.from('admin_notes').insert({
      created_by: author.id, tag: 'note', content: 'x',
      eo_dive_id: diveId, eo_course_id: courseId,
    })
    expect(two.error).toBeTruthy()

    const three = await admin.from('admin_notes').insert({
      created_by: author.id, tag: 'note', content: 'x',
      eo_dive_id: diveId, eo_course_id: courseId, booking_id: bookingId,
    })
    expect(three.error).toBeTruthy()
  })

  it('accepts and round-trips a dive note', async () => {
    const { data, error } = await admin.from('admin_notes').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'gear', content: 'Need extra wetsuits',
    }).select().single()
    expect(error).toBeNull()
    expect(data!.tag).toBe('gear')
    expect(data!.eo_dive_id).toBe(diveId)
    expect(data!.eo_course_id).toBeNull()
    expect(data!.booking_id).toBeNull()
    expect(data!.resolved).toBe(false)
    if (data) noteIds.push(data.id)
  })

  it('accepts a booking-scoped note (gear-map use case)', async () => {
    const { data, error } = await admin.from('admin_notes').insert({
      created_by: author.id, booking_id: bookingId,
      tag: 'gear', content: 'Bring spare mask — theirs leaks',
    }).select().single()
    expect(error).toBeNull()
    expect(data!.booking_id).toBe(bookingId)
    expect(data!.eo_dive_id).toBeNull()
    if (data) noteIds.push(data.id)
  })

  it('rejects an unknown tag', async () => {
    const { error } = await admin.from('admin_notes').insert({
      created_by: author.id, eo_dive_id: diveId,
      // @ts-expect-error — not in the tag enum
      tag: 'zomg', content: 'x',
    })
    expect(error).toBeTruthy()
  })

  it('rejects empty content and overly long content', async () => {
    const empty = await admin.from('admin_notes').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'note', content: '',
    })
    expect(empty.error).toBeTruthy()

    const huge = await admin.from('admin_notes').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'note', content: 'x'.repeat(2001),
    })
    expect(huge.error).toBeTruthy()
  })

  it('rejects resolved=true without resolved_by/resolved_at', async () => {
    const { error } = await admin.from('admin_notes').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'note', content: 'x',
      resolved: true,
    })
    expect(error).toBeTruthy()
  })

  it('accepts the full resolved state (resolved + resolver + time)', async () => {
    const { data, error } = await admin.from('admin_notes').insert({
      created_by: author.id, eo_course_id: courseId,
      tag: 'payment', content: 'Bank transfer not yet received',
      resolved: true, resolved_by: resolver.id, resolved_at: new Date().toISOString(),
    }).select().single()
    expect(error).toBeNull()
    expect(data!.resolved).toBe(true)
    expect(data!.resolved_by).toBe(resolver.id)
    expect(data!.resolved_at).not.toBeNull()
    if (data) noteIds.push(data.id)
  })

  it('resolving an open note updates all three fields atomically', async () => {
    const ins = await admin.from('admin_notes').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'urgent', content: 'Check tanks',
    }).select().single()
    if (ins.data) noteIds.push(ins.data.id)

    const resolvedAt = new Date().toISOString()
    const { data, error } = await admin
      .from('admin_notes')
      .update({ resolved: true, resolved_by: resolver.id, resolved_at: resolvedAt })
      .eq('id', ins.data!.id)
      .select().single()
    expect(error).toBeNull()
    expect(data!.resolved).toBe(true)
    expect(data!.resolved_by).toBe(resolver.id)
  })

  it('deleting a dive cascades to remove its notes', async () => {
    const tempDive = await createTestDive(admin)
    const ins = await admin.from('admin_notes').insert({
      created_by: author.id, eo_dive_id: tempDive, tag: 'note', content: 'to be orphaned',
    }).select().single()
    expect(ins.error).toBeNull()

    await deleteTestDive(admin, tempDive)

    const { data } = await admin.from('admin_notes').select('id').eq('id', ins.data!.id)
    expect(data ?? []).toEqual([])
  })

  it('deleting a booking cascades to remove its notes', async () => {
    // Use a fresh dive so the (user_id, eo_dive_id) unique index doesn't
    // collide with the suite-level booking made in beforeAll.
    const tempDive = await createTestDive(admin)
    const { data: b, error: bErr } = await admin.from('bookings').insert({
      user_id: author.id, eo_dive_id: tempDive, status: 'pending',
    }).select().single()
    expect(bErr).toBeNull()

    const ins = await admin.from('admin_notes').insert({
      created_by: author.id, booking_id: b!.id, tag: 'gear', content: 'spare fins',
    }).select().single()
    expect(ins.error).toBeNull()

    await admin.from('bookings').delete().eq('id', b!.id)

    const { data } = await admin.from('admin_notes').select('id').eq('id', ins.data!.id)
    expect(data ?? []).toEqual([])

    await deleteTestDive(admin, tempDive)
  })
})
