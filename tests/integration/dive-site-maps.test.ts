// Integration tests for dive-site map storage (20260827500000).
//
// The renderer and editor existed behind a development-only route where every
// depth a diver placed was lost on reload. What we lock in about the storage
// that replaced it:
//   1. Staff file readings; a diver can neither file them nor read them back.
//      The map is admin-only for now, and that has to mean the data and not
//      just the button — the tables are one PostgREST call from any session.
//   2. A contribution is marked unverified, and every reading points back at
//      the batch it arrived on, so it stays attributable forever.
//   3. The lattice reconciles: two divers measuring the same square metre
//      produce the same id and the newer reading replaces the older, rather
//      than stacking two depths on one spot.
//   4. Features keep their geometry, whichever shape they are.
//   5. Entry points are records like the rest (20260828000000), not a jsonb
//      field on the map: a site has as many ways in as it has, and each one
//      names the diver who marked it.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient, createTestUser, deleteTestUser, type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
let otherAdmin: TestUser
let siteId: string

const sounding = (id: string, x: number, y: number, depth_m: number) => ({
  id, at: { x, y }, depth_m, datum: 'instantaneous',
  observed_at: new Date().toISOString(), source: 'diver',
})

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver = await createTestUser(admin, { role: 'diver' })
  otherAdmin = await createTestUser(admin, { role: 'admin' })
  const { data, error } = await admin.from('dive_sites')
    .insert({ name: `Map Site ${crypto.randomUUID().slice(0, 8)}`, kind: 'dive' } as never)
    .select('id').single()
  if (error) throw new Error(error.message)
  siteId = (data as { id: string }).id
})

afterAll(async () => {
  await admin.from('dive_sites').delete().eq('id', siteId)
  for (const u of [adminUser, diver, otherAdmin]) if (u) await deleteTestUser(admin, u.id)
})

const entry = (id: string, x: number, y: number, label?: string) =>
  ({ id, at: { x, y }, ...(label ? { label } : {}), source: 'diver' })

async function fileAs(
  user: TestUser, soundings: unknown[], features: unknown[] = [], entries: unknown[] = [],
) {
  const db = await userClient(user.email, user.password)
  return db.rpc('submit_site_map_contribution', {
    p_site_id: siteId, p_soundings: soundings, p_features: features, p_entries: entries,
  })
}

describe('filing readings', () => {
  // Closed at the RPC, not just in the nav. A SECURITY DEFINER function runs
  // past RLS by design, so without its own check a diver who found the
  // endpoint could file into a map they cannot even read.
  it('refuses a diver, both filing and reading', async () => {
    expect((await fileAs(diver, [sounding('lat:5:5', 5, 5, 9)])).error).not.toBeNull()

    const db = await userClient(diver.email, diver.password)
    const { data: rows } = await db.from('dive_site_soundings').select('*').eq('site_id', siteId)
    expect(rows ?? []).toHaveLength(0)
  })

  it('records a batch and credits the staff member who filed it', async () => {
    const { data, error } = await fileAs(adminUser, [sounding('lat:3:4', 3, 4, 12.5)])
    expect(error).toBeNull()

    const { data: contribution } = await admin.from('dive_site_contributions')
      .select('*').eq('id', data as string).single()
    expect(contribution!.diver_id).toBe(adminUser.id)

    const { data: rows } = await admin.from('dive_site_soundings')
      .select('*').eq('site_id', siteId).eq('id', 'lat:3:4')
    expect(rows).toHaveLength(1)
    expect(Number(rows![0].depth_m)).toBe(12.5)
    expect(rows![0].source).toBe('diver')
    // Every reading names the batch it arrived on, which is what keeps it
    // attributable once a hundred of them are on one site.
    expect(rows![0].contribution_id).toBe(data as string)
  })

  it('gives the site a map row the first time anybody records anything', async () => {
    const { data } = await admin.from('dive_site_maps').select('site_id').eq('site_id', siteId)
    expect(data).toHaveLength(1)
  })

  // The reason the id is derived from the coordinate rather than generated.
  it('lets a second person correct the same square metre instead of duplicating it', async () => {
    await fileAs(adminUser, [sounding('lat:10:10', 10, 10, 8)])
    const second = await fileAs(otherAdmin, [sounding('lat:10:10', 10, 10, 24)])
    expect(second.error).toBeNull()

    const { data: rows } = await admin.from('dive_site_soundings')
      .select('*').eq('site_id', siteId).eq('id', 'lat:10:10')
    expect(rows).toHaveLength(1)
    expect(Number(rows![0].depth_m)).toBe(24)
    // And the correction is credited to whoever made it.
    const { data: contribution } = await admin.from('dive_site_contributions')
      .select('diver_id').eq('id', rows![0].contribution_id!).single()
    expect(contribution!.diver_id).toBe(otherAdmin.id)
  })

  it('keeps a feature’s geometry, whichever shape it is', async () => {
    const { error } = await fileAs(adminUser, [], [
      { id: 'f-point', kind: 'rock', geometry: { shape: 'point', at: { x: 1, y: 2 } } },
      { id: 'f-path', kind: 'wall', label: 'Dragon Head',
        geometry: { shape: 'path', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] } },
    ])
    expect(error).toBeNull()

    const { data: rows } = await admin.from('dive_site_features')
      .select('*').eq('site_id', siteId).order('id')
    const point = rows!.find(r => r.id === 'f-point')!
    // A point is stored as a one-element array so every shape reads the same
    // way and nothing has to branch on which column to look in.
    expect(point.shape).toBe('point')
    expect(point.points).toEqual([{ x: 1, y: 2 }])
    const path = rows!.find(r => r.id === 'f-path')!
    expect(path.points).toHaveLength(2)
    expect(path.label).toBe('Dragon Head')
  })

  it('refuses an empty contribution', async () => {
    const { error } = await fileAs(adminUser, [], [], [])
    expect(error).not.toBeNull()
  })

  it('refuses readings against a place that does not exist', async () => {
    const db = await userClient(diver.email, diver.password)
    const { error } = await db.rpc('submit_site_map_contribution', {
      p_site_id: crypto.randomUUID(),
      p_soundings: [sounding('lat:1:1', 1, 1, 5)],
    })
    expect(error).not.toBeNull()
  })

  // The reason this is an RPC and not an INSERT policy.
  it('refuses a diver writing the tables directly, however they dress the row', async () => {
    const db = await userClient(diver.email, diver.password)
    expect((await db.from('dive_site_soundings').insert({
      id: 'lat:99:99', site_id: siteId, x: 99, y: 99, depth_m: 5, source: 'survey',
    } as never)).error).not.toBeNull()
    expect((await db.from('dive_site_contributions').insert({
      site_id: siteId, diver_id: diver.id,
    } as never)).error).not.toBeNull()
  })

  it('marks a staff member’s own contribution verified on the way in', async () => {
    const { data } = await fileAs(adminUser, [sounding('lat:7:7', 7, 7, 15)])
    const { data: contribution } = await admin.from('dive_site_contributions')
      .select('verified').eq('id', data as string).single()
    expect(contribution!.verified).toBe(true)
  })
})

describe('checking a contribution', () => {
  it('is admin-only', async () => {
    const { data: id } = await fileAs(adminUser, [sounding('lat:20:20', 20, 20, 9)])
    const db = await userClient(diver.email, diver.password)
    expect((await db.rpc('verify_site_map_contribution', {
      p_contribution_id: id as string,
    })).error).not.toBeNull()

    const adminDb = await userClient(adminUser.email, adminUser.password)
    expect((await adminDb.rpc('verify_site_map_contribution', {
      p_contribution_id: id as string,
    })).error).toBeNull()

    const { data: after } = await admin.from('dive_site_contributions')
      .select('verified').eq('id', id as string).single()
    expect(after!.verified).toBe(true)
  })
})

describe('reading a map back', () => {
  it('is readable by staff', async () => {
    const db = await userClient(otherAdmin.email, otherAdmin.password)
    const { data, error } = await db.from('dive_site_soundings').select('*').eq('site_id', siteId)
    expect(error).toBeNull()
    expect((data ?? []).length).toBeGreaterThan(0)
  })

  // Losing a place would otherwise leave its depths pointing at nothing.
  it('takes the map down with the place', async () => {
    const { data: site } = await admin.from('dive_sites')
      .insert({ name: `Doomed ${crypto.randomUUID().slice(0, 8)}`, kind: 'dive' } as never)
      .select('id').single()
    const doomed = (site as { id: string }).id

    const db = await userClient(adminUser.email, adminUser.password)
    await db.rpc('submit_site_map_contribution', {
      p_site_id: doomed, p_soundings: [sounding('lat:1:1', 1, 1, 5)],
    })
    await admin.from('dive_sites').delete().eq('id', doomed)

    const { data: left } = await admin.from('dive_site_soundings').select('id').eq('site_id', doomed)
    expect(left).toHaveLength(0)
  })
})


// Entry points used to be a jsonb array on the map row, on the reasoning that
// they came off a hand-drawn plan and nobody would ever write one. Divers mark
// them now, so they are records: attributable, reconcilable, and as many per
// site as the site has ways into the water.
describe('ways into the water', () => {
  it('files one on its own, with no depth attached to it', async () => {
    const { data, error } = await fileAs(adminUser, [], [], [entry('ent:2:3', 2, 3, 'Slipway')])
    expect(error).toBeNull()

    const { data: rows } = await admin.from('dive_site_entries')
      .select('*').eq('site_id', siteId).eq('id', 'ent:2:3')
    expect(rows).toHaveLength(1)
    expect(rows![0]).toMatchObject({
      label: 'Slipway', source: 'diver', contribution_id: data as string,
    })
    expect(Number(rows![0].x)).toBe(2)
    expect(Number(rows![0].y)).toBe(3)
  })

  it('keeps every one a site has, rather than one at a time', async () => {
    await fileAs(adminUser, [], [], [
      entry('ent:40:0', 40, 0, 'Steps'),
      entry('ent:0:40', 0, 40, 'The gully'),
    ])
    const { data: rows } = await admin.from('dive_site_entries')
      .select('id').eq('site_id', siteId)
    const ids = (rows ?? []).map(r => r.id)
    expect(ids).toEqual(expect.arrayContaining(['ent:40:0', 'ent:0:40']))
  })

  // Same reconciliation the soundings get: the id is the lattice position, so
  // the second diver to mark a slipway is confirming it, not adding another.
  it('lets a second person correct the name instead of duplicating the place', async () => {
    await fileAs(adminUser, [], [], [entry('ent:9:9', 9, 9, 'Rocks')])
    await fileAs(otherAdmin, [], [], [entry('ent:9:9', 9, 9, 'North steps')])

    const { data: rows } = await admin.from('dive_site_entries')
      .select('label').eq('site_id', siteId).eq('id', 'ent:9:9')
    expect(rows).toHaveLength(1)
    expect(rows![0].label).toBe('North steps')
  })

  it('refuses a diver, both filing and reading', async () => {
    expect((await fileAs(diver, [], [], [entry('ent:5:5', 5, 5)])).error).not.toBeNull()

    const db = await userClient(diver.email, diver.password)
    const { data: rows } = await db.from('dive_site_entries').select('*').eq('site_id', siteId)
    expect(rows ?? []).toHaveLength(0)
  })

  it('refuses a diver writing the table directly', async () => {
    const db = await userClient(diver.email, diver.password)
    expect((await db.from('dive_site_entries').insert({
      id: 'ent:99:99', site_id: siteId, x: 99, y: 99, source: 'survey',
    } as never)).error).not.toBeNull()
  })

  // The column it replaced is gone, so there is only ever one answer to
  // "where do you get in".
  it('has no jsonb twin left on the map row', async () => {
    const { data } = await admin.from('dive_site_maps').select('*').eq('site_id', siteId).single()
    expect(data).not.toBeNull()
    expect('entries' in (data as object)).toBe(false)
  })
})
