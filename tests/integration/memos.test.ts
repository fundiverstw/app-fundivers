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
const memoIds: string[] = []

beforeAll(async () => {
  author = await createTestUser(admin)
  resolver = await createTestUser(admin, { role: 'admin' })
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  if (memoIds.length) await admin.from('event_memos').delete().in('id', memoIds)
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  for (const u of [author, resolver]) if (u) await deleteTestUser(admin, u.id).catch(() => {})
})

describe('event_memos constraints', () => {
  it('XOR event_id — exactly one of dive or course must be set', async () => {
    const neither = await admin.from('event_memos').insert({
      created_by: author.id, tag: 'note', content: 'x',
    })
    expect(neither.error).toBeTruthy()

    const both = await admin.from('event_memos').insert({
      created_by: author.id, tag: 'note', content: 'x',
      eo_dive_id: diveId, eo_course_id: courseId,
    })
    expect(both.error).toBeTruthy()
  })

  it('accepts and round-trips a dive memo', async () => {
    const { data, error } = await admin.from('event_memos').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'gear', content: 'Need extra wetsuits',
    }).select().single()
    expect(error).toBeNull()
    expect(data!.tag).toBe('gear')
    expect(data!.eo_dive_id).toBe(diveId)
    expect(data!.eo_course_id).toBeNull()
    expect(data!.resolved).toBe(false)
    if (data) memoIds.push(data.id)
  })

  it('rejects an unknown tag', async () => {
    const { error } = await admin.from('event_memos').insert({
      created_by: author.id, eo_dive_id: diveId,
      // @ts-expect-error — not in the tag enum
      tag: 'zomg', content: 'x',
    })
    expect(error).toBeTruthy()
  })

  it('rejects empty content and overly long content', async () => {
    const empty = await admin.from('event_memos').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'note', content: '',
    })
    expect(empty.error).toBeTruthy()

    const huge = await admin.from('event_memos').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'note', content: 'x'.repeat(2001),
    })
    expect(huge.error).toBeTruthy()
  })

  it('rejects resolved=true without resolved_by/resolved_at', async () => {
    const { error } = await admin.from('event_memos').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'note', content: 'x',
      resolved: true,
    })
    expect(error).toBeTruthy()
  })

  it('accepts the full resolved state (resolved + resolver + time)', async () => {
    const { data, error } = await admin.from('event_memos').insert({
      created_by: author.id, eo_course_id: courseId,
      tag: 'payment', content: 'Bank transfer not yet received',
      resolved: true, resolved_by: resolver.id, resolved_at: new Date().toISOString(),
    }).select().single()
    expect(error).toBeNull()
    expect(data!.resolved).toBe(true)
    expect(data!.resolved_by).toBe(resolver.id)
    expect(data!.resolved_at).not.toBeNull()
    if (data) memoIds.push(data.id)
  })

  it('resolving an open memo updates all three fields atomically', async () => {
    const ins = await admin.from('event_memos').insert({
      created_by: author.id, eo_dive_id: diveId, tag: 'urgent', content: 'Check tanks',
    }).select().single()
    if (ins.data) memoIds.push(ins.data.id)

    const resolvedAt = new Date().toISOString()
    const { data, error } = await admin
      .from('event_memos')
      .update({ resolved: true, resolved_by: resolver.id, resolved_at: resolvedAt })
      .eq('id', ins.data!.id)
      .select().single()
    expect(error).toBeNull()
    expect(data!.resolved).toBe(true)
    expect(data!.resolved_by).toBe(resolver.id)
  })

  it('deleting a dive cascades to remove its memos', async () => {
    const tempDive = await createTestDive(admin)
    const ins = await admin.from('event_memos').insert({
      created_by: author.id, eo_dive_id: tempDive, tag: 'note', content: 'to be orphaned',
    }).select().single()
    expect(ins.error).toBeNull()

    await deleteTestDive(admin, tempDive)

    const { data } = await admin.from('event_memos').select('id').eq('id', ins.data!.id)
    expect(data ?? []).toEqual([])
  })
})
