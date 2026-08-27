// Integration tests for the crowdsourced dive-site catalog (20260827300000).
//
// The catalog stopped being admin-only, which put every diver one step from
// filing an observation against a place nobody had entered yet. What we lock
// in is that opening it did not open it to a pile of near-identical rows:
//   1. Any signed-in diver can add a place, and what they add is marked
//      unverified; only an admin's is verified on the way in.
//   2. Nobody can write the table directly — `verified` and `created_by` are
//      claims about a row that its author must not get to make.
//   3. The search finds an existing place from ANY of its names, in any
//      language, and from an alias nobody displays.
//   4. Merging carries the observations across and keeps the duplicate's names
//      as aliases, so the spelling that caused it finds the survivor next time.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
const createdSites: string[] = []

async function site(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from('dive_sites')
    .insert({ name, kind: 'dive', ...extra } as never).select('id').single()
  if (error) throw new Error(`site insert failed: ${error.message}`)
  const id = (data as { id: string }).id
  createdSites.push(id)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of createdSites) await admin.from('dive_sites').delete().eq('id', id)
  await deleteTestUser(admin, adminUser.id)
  await deleteTestUser(admin, diver.id)
})

describe('adding a place', () => {
  it('lets any diver add one, and marks it unverified', async () => {
    const db = await userClient(diver.email, diver.password)
    const { data, error } = await db.rpc('create_dive_site', {
      p_name: `Diver Reef ${crypto.randomUUID().slice(0, 8)}`,
      p_kind: 'dive',
      p_name_zh_tw: '潛水員礁',
    })
    expect(error).toBeNull()
    createdSites.push(data as string)

    const { data: row } = await admin.from('dive_sites').select('*').eq('id', data as string).single()
    expect(row!.verified).toBe(false)
    expect(row!.created_by).toBe(diver.id)
    expect(row!.name_zh_tw).toBe('潛水員礁')
  })

  it('marks an admin-added place verified on the way in', async () => {
    const db = await userClient(adminUser.email, adminUser.password)
    const { data } = await db.rpc('create_dive_site', {
      p_name: `Staff Reef ${crypto.randomUUID().slice(0, 8)}`, p_kind: 'dive',
    })
    createdSites.push(data as string)

    const { data: row } = await admin.from('dive_sites').select('verified').eq('id', data as string).single()
    expect(row!.verified).toBe(true)
  })

  // The reason this is an RPC and not an INSERT policy.
  it('refuses a diver writing the table directly, however they dress the row', async () => {
    const db = await userClient(diver.email, diver.password)
    const { error } = await db.from('dive_sites')
      .insert({ name: 'Forged Reef', kind: 'dive', verified: true } as never)
    expect(error).not.toBeNull()
  })

  it('refuses a nameless place, and half a coordinate', async () => {
    const db = await userClient(diver.email, diver.password)
    expect((await db.rpc('create_dive_site', { p_name: '   ', p_kind: 'dive' })).error).not.toBeNull()
    expect((await db.rpc('create_dive_site', {
      p_name: 'Half Located', p_kind: 'dive', p_latitude: 25.1,
    })).error).not.toBeNull()
  })
})

describe('finding what is already there', () => {
  let batCave: string

  beforeAll(async () => {
    batCave = await site(`Bat Cave ${crypto.randomUUID().slice(0, 8)}`, {
      name_zh_tw: `蝙蝠洞${crypto.randomUUID().slice(0, 4)}`,
      name_ja: `バット・ケーブ${crypto.randomUUID().slice(0, 4)}`,
    })
    await admin.from('dive_site_aliases')
      .insert({ site_id: batCave, name: `Fledermaushoehle${crypto.randomUUID().slice(0, 4)}` } as never)
  })

  async function search(term: string) {
    const db = await userClient(diver.email, diver.password)
    const { data, error } = await db.rpc('find_similar_dive_sites', { p_name: term, p_kind: 'dive' })
    if (error) throw new Error(error.message)
    return (data ?? []) as Array<{ id: string; matched_name: string; score: number }>
  }

  it('shrugs off case, spacing and punctuation', async () => {
    const { data: row } = await admin.from('dive_sites').select('name').eq('id', batCave).single()
    const messy = `  ${row!.name.toLowerCase().replace(' ', '--')}!  `
    expect((await search(messy)).map(r => r.id)).toContain(batCave)
  })

  it('finds the English row from its Chinese name, and from its Japanese one', async () => {
    const { data: row } = await admin.from('dive_sites')
      .select('name_zh_tw, name_ja').eq('id', batCave).single()
    expect((await search(row!.name_zh_tw!)).map(r => r.id)).toContain(batCave)
    expect((await search(row!.name_ja!)).map(r => r.id)).toContain(batCave)
  })

  it('finds it from an alias nobody ever displays', async () => {
    const { data: alias } = await admin.from('dive_site_aliases')
      .select('name').eq('site_id', batCave).limit(1).single()
    const hits = await search(alias!.name)
    expect(hits.map(r => r.id)).toContain(batCave)
    // The matched name comes back so the form can say WHY it is suggesting this.
    expect(hits.find(r => r.id === batCave)!.matched_name).toBe(alias!.name)
  })

  it('says nothing about a place that really is new', async () => {
    expect(await search('Zzyzx Trench Alpha')).toHaveLength(0)
  })

  it('returns one row per site, not one per name that matched', async () => {
    const { data: row } = await admin.from('dive_sites').select('name').eq('id', batCave).single()
    const hits = await search(row!.name)
    expect(hits.filter(r => r.id === batCave)).toHaveLength(1)
  })
})

describe('cleaning up a duplicate', () => {
  it('is admin-only, both verifying and merging', async () => {
    const db = await userClient(diver.email, diver.password)
    const a = await site(`Lone Reef ${crypto.randomUUID().slice(0, 8)}`)
    const b = await site(`Lone Reef Two ${crypto.randomUUID().slice(0, 8)}`)
    expect((await db.rpc('verify_dive_site', { p_site_id: a })).error).not.toBeNull()
    expect((await db.rpc('merge_dive_sites', { p_keep: a, p_merge: b })).error).not.toBeNull()
  })

  it('carries the observations across and keeps the duplicate as an alias', async () => {
    const keep = await site(`Keep Reef ${crypto.randomUUID().slice(0, 8)}`)
    const dupe = await site(`Keeep Reef ${crypto.randomUUID().slice(0, 8)}`, { name_zh_tw: '重複礁' })
    const { data: dupeRow } = await admin.from('dive_sites').select('name').eq('id', dupe).single()

    const db = await userClient(diver.email, diver.password)
    const { data: recordId } = await db.rpc('submit_almanac_record', {
      p_site_id: dupe,
      p_obs_date: new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA'),
      p_water_temp_c: 26,
    })

    const adminDb = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminDb.rpc('merge_dive_sites', { p_keep: keep, p_merge: dupe })
    expect(error).toBeNull()

    // The observation survived, pointing at the place that stayed.
    const { data: record } = await admin.from('almanac_records')
      .select('site_id').eq('id', recordId as string).single()
    expect(record!.site_id).toBe(keep)

    // And the spelling that caused the duplicate now finds the survivor.
    const { data: hits } = await db.rpc('find_similar_dive_sites', {
      p_name: dupeRow!.name, p_kind: 'dive',
    })
    expect((hits ?? []).map(h => h.id)).toContain(keep)
    // Including the Chinese name the duplicate carried and the survivor did not.
    const { data: survivor } = await admin.from('dive_sites').select('name_zh_tw').eq('id', keep).single()
    expect(survivor!.name_zh_tw).toBe('重複礁')

    expect((await admin.from('dive_sites').select('id').eq('id', dupe)).data).toHaveLength(0)
  })

  // One record per diver per place per day: a diver who filed against both
  // halves on the same day has two rows that cannot both survive the merge.
  it('drops the duplicate record rather than failing the whole merge', async () => {
    const keep = await site(`Twin Reef ${crypto.randomUUID().slice(0, 8)}`)
    const dupe = await site(`Twinn Reef ${crypto.randomUUID().slice(0, 8)}`)
    const day = new Date(Date.now() - 2 * 86_400_000).toLocaleDateString('en-CA')

    const db = await userClient(diver.email, diver.password)
    const { data: kept } = await db.rpc('submit_almanac_record', {
      p_site_id: keep, p_obs_date: day, p_water_temp_c: 27,
    })
    await db.rpc('submit_almanac_record', { p_site_id: dupe, p_obs_date: day, p_water_temp_c: 21 })

    const adminDb = await userClient(adminUser.email, adminUser.password)
    expect((await adminDb.rpc('merge_dive_sites', { p_keep: keep, p_merge: dupe })).error).toBeNull()

    const { data: left } = await admin.from('almanac_records')
      .select('id, water_temp_c').eq('site_id', keep).eq('obs_date', day)
    expect(left).toHaveLength(1)
    expect(left![0].id).toBe(kept as string)
  })

  it('refuses to merge a place into itself', async () => {
    const a = await site(`Self Reef ${crypto.randomUUID().slice(0, 8)}`)
    const adminDb = await userClient(adminUser.email, adminUser.password)
    expect((await adminDb.rpc('merge_dive_sites', { p_keep: a, p_merge: a })).error).not.toBeNull()
  })
})
