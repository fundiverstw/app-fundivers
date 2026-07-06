import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the admin-write RLS contract on the unified events table (dive + course
// kinds). The /admin/new tab depends on these policies; if they regress, admins
// can't create events from the SPA. Divers must remain blocked.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdDiveIds: string[] = []
const createdCourseIds: string[] = []

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdDiveIds)   await admin.from('events' as never).delete().eq('id', id)
  for (const id of createdCourseIds) await admin.from('events' as never).delete().eq('id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('events admin writes (dive kind)', () => {
  it('admin can insert', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    const { error } = await sb.from('events' as never).insert({
      id, kind: 'dive', admin_title: 'Admin-created dive', notes: '', start_date: '2026-06-01',
    } as never)
    expect(error).toBeNull()
  })

  it('admin can update', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    await admin.from('events' as never).insert({ id, kind: 'dive', admin_title: 'pre', notes: '', start_date: '2026-06-01' } as never)
    const { error } = await sb.from('events' as never).update({ admin_title: 'post' } as never).eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('events' as never).select('admin_title').eq('id', id).single<{ admin_title: string }>()
    expect(data?.admin_title).toBe('post')
  })

  it('admin can delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    await admin.from('events' as never).insert({ id, kind: 'dive', admin_title: 'doomed', notes: '', start_date: '2026-06-01' } as never)
    const { error } = await sb.from('events' as never).delete().eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('events' as never).select('id').eq('id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('admin can move a single-day dive date (drag-to-reschedule write)', async () => {
    // Mirrors rescheduleEventDay()'s dive branch: move start_date + end_date.
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    await admin.from('events' as never).insert({
      id, kind: 'dive', admin_title: 'movable', notes: '', start_date: '2026-06-01', end_date: '2026-06-01',
    } as never)
    const { error } = await sb.from('events' as never)
      .update({ start_date: '2026-06-05', end_date: '2026-06-05' } as never).eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('events' as never)
      .select('start_date, end_date').eq('id', id).single<{ start_date: string; end_date: string }>()
    expect(data?.start_date).toBe('2026-06-05')
    expect(data?.end_date).toBe('2026-06-05')
  })

  it('diver cannot insert', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('events' as never).insert({
      id, kind: 'dive', admin_title: 'diver tried', notes: '', start_date: '2026-06-01',
    } as never)
    expect(error).not.toBeNull()
    const { data } = await admin.from('events' as never).select('id').eq('id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot update', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    await admin.from('events' as never).insert({ id, kind: 'dive', admin_title: 'before', notes: '', start_date: '2026-06-01' } as never)
    const { error, count } = await sb
      .from('events' as never)
      .update({ admin_title: 'after' } as never, { count: 'exact' })
      .eq('id', id)
    // RLS may silently filter (count=0) or raise; either is acceptable as
    // long as the row is unchanged.
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('events' as never).select('admin_title').eq('id', id).single<{ admin_title: string }>()
    expect(data?.admin_title).toBe('before')
  })

  it('diver cannot delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    await admin.from('events' as never).insert({ id, kind: 'dive', admin_title: 'survives', notes: '', start_date: '2026-06-01' } as never)
    const { error, count } = await sb.from('events' as never).delete({ count: 'exact' }).eq('id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('events' as never).select('id').eq('id', id).maybeSingle()
    expect(data).not.toBeNull()
  })
})

describe('events admin writes (course kind)', () => {
  it('admin can insert', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdCourseIds.push(id)
    const { error } = await sb.from('events' as never).insert({
      id, kind: 'course', display_title: 'Admin-created course', course_days: ['2026-06-01'],
    } as never)
    expect(error).toBeNull()
  })

  it('admin can update', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdCourseIds.push(id)
    await admin.from('events' as never).insert({ id, kind: 'course', display_title: 'pre', course_days: ['2026-06-01'] } as never)
    const { error } = await sb.from('events' as never).update({ display_title: 'post' } as never).eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('events' as never).select('display_title').eq('id', id).single<{ display_title: string }>()
    expect(data?.display_title).toBe('post')
  })

  it('admin can delete', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    await admin.from('events' as never).insert({ id, kind: 'course', display_title: 'doomed', course_days: ['2026-06-01'] } as never)
    const { error } = await sb.from('events' as never).delete().eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('events' as never).select('id').eq('id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('admin can move one course day (drag-to-reschedule write)', async () => {
    // Mirrors rescheduleEventDay()'s course branch: swap one day in
    // course_days. Moves 05-16 -> 05-18. There's no start/end envelope to
    // maintain — course_days is the sole date source.
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdCourseIds.push(id)
    await admin.from('events' as never).insert({
      id, kind: 'course', display_title: 'reschedulable',
      course_days: ['2026-05-09', '2026-05-10', '2026-05-16'],
    } as never)
    const days = ['2026-05-09', '2026-05-10', '2026-05-18']
    const { error } = await sb.from('events' as never)
      .update({ course_days: days } as never).eq('id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('events' as never)
      .select('course_days').eq('id', id)
      .single<{ course_days: string[] }>()
    expect(data?.course_days).toEqual(days)
  })

  it('diver cannot insert', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    const { error } = await sb.from('events' as never).insert({
      id, kind: 'course', display_title: 'diver tried', course_days: ['2026-06-01'],
    } as never)
    expect(error).not.toBeNull()
    const { data } = await admin.from('events' as never).select('id').eq('id', id).maybeSingle()
    expect(data).toBeNull()
  })

  it('diver cannot update', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdCourseIds.push(id)
    await admin.from('events' as never).insert({ id, kind: 'course', display_title: 'before', course_days: ['2026-06-01'] } as never)
    const { error, count } = await sb
      .from('events' as never)
      .update({ display_title: 'after' } as never, { count: 'exact' })
      .eq('id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('events' as never).select('display_title').eq('id', id).single<{ display_title: string }>()
    expect(data?.display_title).toBe('before')
  })

  it('diver cannot delete', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdCourseIds.push(id)
    await admin.from('events' as never).insert({ id, kind: 'course', display_title: 'survives', course_days: ['2026-06-01'] } as never)
    const { error, count } = await sb.from('events' as never).delete({ count: 'exact' }).eq('id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('events' as never).select('id').eq('id', id).maybeSingle()
    expect(data).not.toBeNull()
  })
})
