import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Pins the deposit_deadline + full_payment_deadline contract on
// EO_dives / EO_courses:
//   - schema migration applied (columns exist, accept dates, default null)
//   - admin update RLS lets admins set them
//   - diver update RLS still blocks all writes (regression check that the
//     new columns didn't accidentally get separately exposed)

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
  for (const id of createdDiveIds)   await admin.from('EO_dives'   as never).delete().eq('_id', id)
  for (const id of createdCourseIds) await admin.from('EO_courses' as never).delete().eq('_id', id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('EO_dives.deposit_deadline / full_payment_deadline', () => {
  it('default to null on insert', async () => {
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    await admin.from('EO_dives' as never).insert({
      _id: id, dive_title: 'No deadlines yet', notes: '', start_date: '2027-06-01',
    } as never)
    const { data } = await admin.from('EO_dives' as never)
      .select('deposit_deadline, full_payment_deadline').eq('_id', id)
      .single<{ deposit_deadline: string | null; full_payment_deadline: string | null }>()
    expect(data?.deposit_deadline).toBeNull()
    expect(data?.full_payment_deadline).toBeNull()
  })

  it('admin can set both deadlines', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    await admin.from('EO_dives' as never).insert({
      _id: id, dive_title: 'Has deadlines', notes: '', start_date: '2027-06-15',
    } as never)
    const { error } = await sb.from('EO_dives' as never).update({
      deposit_deadline: '2027-05-01',
      full_payment_deadline: '2027-06-08',
    } as never).eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('EO_dives' as never)
      .select('deposit_deadline, full_payment_deadline').eq('_id', id)
      .single<{ deposit_deadline: string; full_payment_deadline: string }>()
    expect(data?.deposit_deadline).toBe('2027-05-01')
    expect(data?.full_payment_deadline).toBe('2027-06-08')
  })

  it('diver cannot update deadlines', async () => {
    const sb = await userClient(diver.email, diver.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    // Seed in two steps so the insert matches the shape used by other
    // tests in this suite — the deadline column is exercised via update.
    await admin.from('EO_dives' as never).insert({
      _id: id, dive_title: 'Locked', notes: '', start_date: '2027-06-15',
    } as never)
    await admin.from('EO_dives' as never)
      .update({ deposit_deadline: '2027-05-01' } as never).eq('_id', id)

    const { error, count } = await sb
      .from('EO_dives' as never)
      .update({ deposit_deadline: '2099-01-01' } as never, { count: 'exact' })
      .eq('_id', id)
    expect(error !== null || count === 0).toBe(true)
    const { data } = await admin.from('EO_dives' as never)
      .select('deposit_deadline').eq('_id', id)
      .single<{ deposit_deadline: string }>()
    expect(data?.deposit_deadline).toBe('2027-05-01')
  })
})

describe('EO_courses.deposit_deadline / full_payment_deadline', () => {
  it('admin can set both deadlines', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdCourseIds.push(id)
    await admin.from('EO_courses' as never).insert({
      _id: id, course_title: 'OW course', start_date: '2027-07-10',
    } as never)
    const { error } = await sb.from('EO_courses' as never).update({
      deposit_deadline: '2027-06-01',
      full_payment_deadline: '2027-07-03',
    } as never).eq('_id', id)
    expect(error).toBeNull()
    const { data } = await admin.from('EO_courses' as never)
      .select('deposit_deadline, full_payment_deadline').eq('_id', id)
      .single<{ deposit_deadline: string; full_payment_deadline: string }>()
    expect(data?.deposit_deadline).toBe('2027-06-01')
    expect(data?.full_payment_deadline).toBe('2027-07-03')
  })
})
