import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diverUser: TestUser
let diveId: string
let courseId: string

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diverUser = await createTestUser(admin, { role: 'diver' })
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  if (diveId)   await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diverUser) await deleteTestUser(admin, diverUser.id)
})

describe('duties table', () => {
  it('accepts a minimal valid duty (admin assignee, role, start_date, no event)', async () => {
    const { data, error } = await admin.from('duties').insert({
      assignee_id: adminUser.id,
      role: 'support',
      start_date: '2030-01-01',
    }).select().single()
    expect(error).toBeNull()
    expect(data?.role).toBe('support')
    expect(data?.event_id).toBeNull()
    await admin.from('duties').delete().eq('id', data!.id)
  })

  it('rejects unknown role via CHECK constraint', async () => {
    const { error } = await admin.from('duties').insert({
      assignee_id: adminUser.id,
      role: 'captain' as 'support',
      start_date: '2030-01-02',
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/check/i)
  })

  it('rejects a diver (non-admin) assignee via trigger', async () => {
    const { error } = await admin.from('duties').insert({
      assignee_id: diverUser.id,
      role: 'guide',
      start_date: '2030-01-03',
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/admin/i)
  })

  it('rejects end_date before start_date', async () => {
    const { error } = await admin.from('duties').insert({
      assignee_id: adminUser.id,
      role: 'guide',
      start_date: '2030-01-10',
      end_date:   '2030-01-09',
    })
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).toMatch(/date/i)
  })

  // Duties formerly carried an eo_dive_id + eo_course_id pair (no XOR — both
  // could be set). Under the unified schema that collapses to a single event_id
  // FK; this pins that a duty can reference one event.
  it('allows event_id to be set to an event', async () => {
    const { data, error } = await admin.from('duties').insert({
      assignee_id: adminUser.id,
      role:        'guide',
      start_date:  '2030-01-04',
      event_id:    diveId,
    }).select().single()
    expect(error).toBeNull()
    expect(data?.event_id).toBe(diveId)
    await admin.from('duties').delete().eq('id', data!.id)
  })

  it('RLS blocks anon selects', async () => {
    const anon = anonClient()
    const { data, error } = await anon.from('duties').select('*').limit(1)
    // RLS returns empty set (no error) for unauthorized selects by default.
    expect(data ?? []).toEqual([])
    expect(error).toBeNull()
  })

  it('RLS blocks diver (non-admin) from inserting a duty', async () => {
    const diverSb = await userClient(diverUser.email, diverUser.password)
    const { error } = await diverSb.from('duties').insert({
      assignee_id: adminUser.id,
      role: 'support',
      start_date: '2030-01-05',
    })
    expect(error).not.toBeNull()
  })
})
