import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestCourse, deleteTestCourse,
  type TestUser,
} from './helpers'

// Pins admin-write + public-read RLS contract on the eo_dive_addons /
// eo_course_addons junction tables. Two regressions matter here:
//
//   1. The original bug — admin INSERT into EO_dives with other_addons
//      set fires sync_eo_dive_addons (plain plpgsql, runs as invoker)
//      which writes into eo_dive_addons. Without an admin-insert
//      policy on the junction, the parent INSERT 403s.
//   2. Public read — src/lib/events.ts resolves addons via the SPA's
//      anon/authenticated key. With RLS on and no select policy, the
//      reads silently return zero rows.
//
// Divers still must not be able to write directly to the junction.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser

const createdDiveIds: string[] = []
const createdAddonIds: string[] = []
let courseId: string

async function createTestAddon(displayName: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('Other_Addons' as never).insert({
    _id: id, display_title: displayName, admin_title: displayName, price: 0, currency: 'TWD',
  } as never)
  if (error) throw error
  createdAddonIds.push(id)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
  courseId  = await createTestCourse(admin)
})

afterAll(async () => {
  if (createdDiveIds.length)  await admin.from('EO_dives'     as never).delete().in('_id', createdDiveIds)
  if (createdAddonIds.length) await admin.from('Other_Addons' as never).delete().in('_id', createdAddonIds)
  if (courseId) await deleteTestCourse(admin, courseId)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('EO_dives admin INSERT with other_addons (junction sync under RLS)', () => {
  it('admin can insert an EO_dive with other_addons set — trigger writes junction without 403', async () => {
    const a1 = await createTestAddon('Junction Addon A')
    const a2 = await createTestAddon('Junction Addon B')

    const sb = await userClient(adminUser.email, adminUser.password)
    const id = crypto.randomUUID()
    createdDiveIds.push(id)

    const startDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    const { error } = await sb.from('EO_dives' as never).insert({
      _id: id,
      admin_title: 'Dive with addons',
      notes: '',
      start_date: startDate,
      time: '09:00:00',
      end_date: startDate,
      other_addons: JSON.stringify([a1, a2]),
    } as never)
    expect(error).toBeNull()

    const { data } = await admin.from('eo_dive_addons')
      .select('addon_id').eq('eo_dive_id', id)
    const ids = (data ?? []).map(r => r.addon_id).sort()
    expect(ids).toEqual([a1, a2].sort())
  })

  it('admin can update other_addons on an EO_dive — trigger reconciles junction', async () => {
    const a1 = await createTestAddon('Junction Addon C')
    const a2 = await createTestAddon('Junction Addon D')

    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    const startDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    await admin.from('EO_dives' as never).insert({
      _id: id, admin_title: 'pre', notes: '', start_date: startDate, time: '09:00:00', end_date: startDate,
      other_addons: JSON.stringify([a1]),
    } as never)

    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.from('EO_dives' as never)
      .update({ other_addons: JSON.stringify([a2]) } as never)
      .eq('_id', id)
    expect(error).toBeNull()

    const { data } = await admin.from('eo_dive_addons')
      .select('addon_id').eq('eo_dive_id', id)
    const ids = (data ?? []).map(r => r.addon_id)
    expect(ids).toEqual([a2])
  })
})

describe('eo_dive_addons / eo_course_addons direct write policies', () => {
  it('diver cannot insert directly into eo_dive_addons', async () => {
    const a = await createTestAddon('Diver-blocked addon')
    const dive = crypto.randomUUID()
    createdDiveIds.push(dive)
    const startDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    await admin.from('EO_dives' as never).insert({
      _id: dive, admin_title: 'd', notes: '', start_date: startDate, time: '09:00:00', end_date: startDate,
    } as never)

    const sb = await userClient(diver.email, diver.password)
    const { error } = await sb.from('eo_dive_addons')
      .insert({ eo_dive_id: dive, addon_id: a })
    expect(error).not.toBeNull()
  })

  it('diver cannot insert directly into eo_course_addons', async () => {
    const a = await createTestAddon('Diver-blocked course addon')
    const sb = await userClient(diver.email, diver.password)
    const { error } = await sb.from('eo_course_addons')
      .insert({ eo_course_id: courseId, addon_id: a })
    expect(error).not.toBeNull()
  })
})

describe('eo_dive_addons / eo_course_addons public read', () => {
  it('authenticated diver can read junction rows (src/lib/events.ts path)', async () => {
    const a = await createTestAddon('Readable addon')
    const dive = crypto.randomUUID()
    createdDiveIds.push(dive)
    const startDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    await admin.from('EO_dives' as never).insert({
      _id: dive, admin_title: 'r', notes: '', start_date: startDate, time: '09:00:00', end_date: startDate,
      other_addons: JSON.stringify([a]),
    } as never)

    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('eo_dive_addons')
      .select('addon_id').eq('eo_dive_id', dive)
    expect(error).toBeNull()
    expect((data ?? []).map(r => r.addon_id)).toEqual([a])
  })
})
