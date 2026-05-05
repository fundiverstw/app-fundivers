import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, createTestDive, createTestCourse, deleteTestDive, deleteTestCourse,
} from './helpers'

const admin = adminClient()
const addonIds: string[] = []
let diveId: string
let courseId: string

async function createTestAddon(displayName: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('Other_Addons' as never).insert({
    _id: id, display_title: displayName, admin_title: displayName, price: 0, currency: 'TWD',
  } as never)
  if (error) throw error
  addonIds.push(id)
  return id
}

beforeAll(async () => {
  diveId = await createTestDive(admin)
  courseId = await createTestCourse(admin)
})

afterAll(async () => {
  if (diveId) await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  if (addonIds.length) await admin.from('Other_Addons' as never).delete().in('_id', addonIds)
})

describe('event-addons junction sync', () => {
  it('populates eo_dive_addons when other_addons is set on an EO_dive', async () => {
    const a1 = await createTestAddon('Addon A')
    const a2 = await createTestAddon('Addon B')

    await admin.from('EO_dives' as never)
      .update({ other_addons: JSON.stringify([a1, a2]) } as never)
      .eq('_id', diveId)

    const { data } = await admin.from('eo_dive_addons')
      .select('addon_id').eq('eo_dive_id', diveId).order('addon_id')
    const ids = (data ?? []).map(r => r.addon_id).sort()
    expect(ids).toEqual([a1, a2].sort())
  })

  it('reconciles junction rows when other_addons changes (remove one, add another)', async () => {
    const a1 = await createTestAddon('Addon C')
    const a2 = await createTestAddon('Addon D')
    const a3 = await createTestAddon('Addon E')

    await admin.from('EO_dives' as never)
      .update({ other_addons: JSON.stringify([a1, a2]) } as never)
      .eq('_id', diveId)
    await admin.from('EO_dives' as never)
      .update({ other_addons: JSON.stringify([a2, a3]) } as never)
      .eq('_id', diveId)

    const { data } = await admin.from('eo_dive_addons')
      .select('addon_id').eq('eo_dive_id', diveId)
    const ids = (data ?? []).map(r => r.addon_id).sort()
    expect(ids).toEqual([a2, a3].sort())
  })

  it('silently skips orphaned IDs that reference no addon row', async () => {
    const real = await createTestAddon('Addon F')
    const fake = 'definitely-not-a-real-addon-id'

    await admin.from('EO_dives' as never)
      .update({ other_addons: JSON.stringify([real, fake]) } as never)
      .eq('_id', diveId)

    const { data } = await admin.from('eo_dive_addons')
      .select('addon_id').eq('eo_dive_id', diveId)
    const ids = (data ?? []).map(r => r.addon_id)
    expect(ids).toEqual([real])
  })

  it('same trigger works for EO_courses via eo_course_addons', async () => {
    const a1 = await createTestAddon('Course Addon G')
    const a2 = await createTestAddon('Course Addon H')

    await admin.from('EO_courses' as never)
      .update({ other_addons: JSON.stringify([a1, a2]) } as never)
      .eq('_id', courseId)

    const { data } = await admin.from('eo_course_addons')
      .select('addon_id').eq('eo_course_id', courseId)
    const ids = (data ?? []).map(r => r.addon_id).sort()
    expect(ids).toEqual([a1, a2].sort())
  })

  it('deleting an addon cascades its junction rows', async () => {
    const a = await createTestAddon('Addon to remove')

    await admin.from('EO_dives' as never)
      .update({ other_addons: JSON.stringify([a]) } as never)
      .eq('_id', diveId)

    await admin.from('Other_Addons' as never).delete().eq('_id', a)
    addonIds.splice(addonIds.indexOf(a), 1)

    const { data } = await admin.from('eo_dive_addons')
      .select('addon_id').eq('eo_dive_id', diveId).eq('addon_id', a)
    expect(data ?? []).toEqual([])
  })
})
