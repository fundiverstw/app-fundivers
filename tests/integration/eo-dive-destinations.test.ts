import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { adminClient, createTestDive, deleteTestDive } from './helpers'

const admin = adminClient()
const destIds: string[] = []
let diveId: string

async function createTestDestination(title: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('TravelDestinations' as never).insert({
    _id: id, admin_title: title, slug: `/test/${id}`, country: 'Testland',
  } as never)
  if (error) throw error
  destIds.push(id)
  return id
}

beforeAll(async () => {
  diveId = await createTestDive(admin)
})

afterAll(async () => {
  if (diveId) await deleteTestDive(admin, diveId)
  if (destIds.length) {
    await admin.from('TravelDestinations' as never).delete().in('_id', destIds)
  }
})

describe('eo_dive_destinations junction sync', () => {
  it('seeds all 24 TravelDestinations from the migration', async () => {
    const { count } = await admin
      .from('TravelDestinations' as never)
      .select('*', { count: 'exact', head: true })
    expect(count).toBe(24)
  })

  it('populates eo_dive_destinations when destination_reference is set', async () => {
    const d1 = await createTestDestination('Test Dest A')
    const d2 = await createTestDestination('Test Dest B')

    await admin.from('EO_dives' as never)
      .update({ destination_reference: JSON.stringify([d1, d2]) } as never)
      .eq('_id', diveId)

    const { data } = await admin.from('eo_dive_destinations')
      .select('destination_id').eq('eo_dive_id', diveId)
    const ids = (data ?? []).map(r => r.destination_id).sort()
    expect(ids).toEqual([d1, d2].sort())
  })

  it('reconciles junction rows when destination_reference changes', async () => {
    const d1 = await createTestDestination('Test Dest C')
    const d2 = await createTestDestination('Test Dest D')
    const d3 = await createTestDestination('Test Dest E')

    await admin.from('EO_dives' as never)
      .update({ destination_reference: JSON.stringify([d1, d2]) } as never)
      .eq('_id', diveId)
    await admin.from('EO_dives' as never)
      .update({ destination_reference: JSON.stringify([d2, d3]) } as never)
      .eq('_id', diveId)

    const { data } = await admin.from('eo_dive_destinations')
      .select('destination_id').eq('eo_dive_id', diveId)
    const ids = (data ?? []).map(r => r.destination_id).sort()
    expect(ids).toEqual([d2, d3].sort())
  })

  it('silently skips orphan ids that reference no destination', async () => {
    const real = await createTestDestination('Test Dest F')
    const fake = '00000000-0000-0000-0000-000000000099'

    await admin.from('EO_dives' as never)
      .update({ destination_reference: JSON.stringify([real, fake]) } as never)
      .eq('_id', diveId)

    const { data } = await admin.from('eo_dive_destinations')
      .select('destination_id').eq('eo_dive_id', diveId)
    expect((data ?? []).map(r => r.destination_id)).toEqual([real])
  })

  it('deleting a destination cascades its junction rows', async () => {
    const d = await createTestDestination('Test Dest to remove')

    await admin.from('EO_dives' as never)
      .update({ destination_reference: JSON.stringify([d]) } as never)
      .eq('_id', diveId)

    await admin.from('TravelDestinations' as never).delete().eq('_id', d)
    destIds.splice(destIds.indexOf(d), 1)

    const { data } = await admin.from('eo_dive_destinations')
      .select('destination_id').eq('eo_dive_id', diveId).eq('destination_id', d)
    expect(data ?? []).toEqual([])
  })
})
