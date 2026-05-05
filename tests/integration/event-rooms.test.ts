import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { adminClient, createTestDive, deleteTestDive } from './helpers'

// Pins the eo_dive_rooms junction sync trigger introduced in
// 20260430040000_eo_dive_rooms_junction.sql. Mirrors event-addons.test.ts.
// The SPA writes EO_dives.room_types as a CSV of UUIDs; the trigger keeps
// eo_dive_rooms in sync. Reads on the SPA hit the junction (FK-enforced).

const admin = adminClient()
const roomIds: string[] = []
let diveId: string

async function createTestRoom(displayName: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('EO_rooms' as never).insert({
    _id: id, display_title: displayName, admin_title: displayName, added_price: 0, currency: 'TWD',
  } as never)
  if (error) throw error
  roomIds.push(id)
  return id
}

beforeAll(async () => {
  diveId = await createTestDive(admin)
})

afterAll(async () => {
  if (diveId) await deleteTestDive(admin, diveId)
  if (roomIds.length) await admin.from('EO_rooms' as never).delete().in('_id', roomIds)
})

describe('eo_dive_rooms junction sync', () => {
  it('populates eo_dive_rooms when room_types is set on an EO_dive', async () => {
    const r1 = await createTestRoom('Room A')
    const r2 = await createTestRoom('Room B')

    await admin.from('EO_dives' as never)
      .update({ room_types: `${r1},${r2}` } as never)
      .eq('_id', diveId)

    const { data } = await admin.from('eo_dive_rooms')
      .select('room_id').eq('eo_dive_id', diveId)
    const ids = (data ?? []).map(r => r.room_id).sort()
    expect(ids).toEqual([r1, r2].sort())
  })

  it('reconciles junction rows when room_types changes (remove one, add another)', async () => {
    const r1 = await createTestRoom('Room C')
    const r2 = await createTestRoom('Room D')
    const r3 = await createTestRoom('Room E')

    await admin.from('EO_dives' as never)
      .update({ room_types: `${r1},${r2}` } as never).eq('_id', diveId)
    await admin.from('EO_dives' as never)
      .update({ room_types: `${r2},${r3}` } as never).eq('_id', diveId)

    const { data } = await admin.from('eo_dive_rooms')
      .select('room_id').eq('eo_dive_id', diveId)
    const ids = (data ?? []).map(r => r.room_id).sort()
    expect(ids).toEqual([r2, r3].sort())
  })

  it('skips orphaned UUIDs that no longer reference an EO_rooms row', async () => {
    const r1 = await createTestRoom('Room F')
    const orphan = crypto.randomUUID()

    await admin.from('EO_dives' as never)
      .update({ room_types: `${r1},${orphan}` } as never).eq('_id', diveId)

    const { data } = await admin.from('eo_dive_rooms')
      .select('room_id').eq('eo_dive_id', diveId)
    const ids = (data ?? []).map(r => r.room_id)
    expect(ids).toContain(r1)
    expect(ids).not.toContain(orphan)
  })

  it('deleting the parent dive cascades junction rows', async () => {
    const r1 = await createTestRoom('Room G')
    const tempDive = await createTestDive(admin)
    await admin.from('EO_dives' as never)
      .update({ room_types: r1 } as never).eq('_id', tempDive)
    const { data: before } = await admin.from('eo_dive_rooms')
      .select('room_id').eq('eo_dive_id', tempDive)
    expect((before ?? []).length).toBe(1)

    await deleteTestDive(admin, tempDive)
    const { data: after } = await admin.from('eo_dive_rooms')
      .select('room_id').eq('eo_dive_id', tempDive)
    expect((after ?? []).length).toBe(0)
  })
})
