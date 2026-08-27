// Integration tests for the almanac (20260818000000) — crowdsourced condition
// records that only reach the crowd once staff approve them. What we lock in:
//   1. The table is read-only to `authenticated`: every write goes through an
//      RPC, so a diver cannot mint an already-approved record.
//   2. submit_almanac_record files a pending record and revises it in place,
//      but refuses a future date and refuses to reopen a reviewed record.
//   3. A pending record is visible to its author and to staff, and to nobody
//      else — approved ones are visible to all.
//   4. The review queue and the ruling RPC are staff/admin only.
//   5. Records hang off the dive_sites catalog: a site with observations
//      cannot be deleted out from under them, and only admins curate it.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let staff: TestUser
let diver: TestUser
let otherDiver: TestUser
let siteId: string

const TODAY = new Date().toLocaleDateString('en-CA')
const YESTERDAY = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')
const TOMORROW = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')
// The guard allows a day of slack, because the client sends a shop-timezone
// date and the database clock is UTC. Two days out is unambiguously future.
const NEXT_WEEK = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('en-CA')

async function clearRecords() {
  await admin.from('almanac_records').delete().eq('site_id', siteId)
}

function recordRow(id: string) {
  return admin.from('almanac_records').select('*').eq('id', id).single()
}

beforeAll(async () => {
  staff = await createTestUser(admin, { role: 'staff' })
  diver = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
  const { data, error } = await admin
    .from('dive_sites')
    .insert({ name: `Bat Cave ${crypto.randomUUID().slice(0, 8)}`, kind: 'dive' } as never)
    .select('id').single()
  if (error) throw new Error(`dive site insert failed: ${error.message}`)
  siteId = (data as { id: string }).id
  await admin.from('profiles').update({ name: 'Almanac Diver' } as never).eq('id', diver.id)
})

afterAll(async () => {
  await clearRecords()
  await admin.from('dive_sites').delete().eq('id', siteId)
  for (const u of [staff, diver, otherDiver]) await deleteTestUser(admin, u.id)
})

describe('almanac_records writes', () => {
  it('refuses a direct insert from a diver — writes are RPC-only', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.from('almanac_records').insert({
      diver_id: diver.id,
      site_id: siteId,
      obs_date: YESTERDAY,
      status: 'approved',
    } as never)
    expect(error).not.toBeNull()
  })

  it('files a pending record and revises it in place', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)

    const first = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: YESTERDAY,
      p_air_temp_c: 28.4,
      p_wildlife: ['turtle'],
    })
    expect(first.error).toBeNull()
    const recordId = first.data as string

    const filed = await recordRow(recordId)
    expect(filed.data!.status).toBe('pending')
    expect(Number(filed.data!.air_temp_c)).toBe(28.4)

    const second = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: YESTERDAY,
      p_water_temp_c: 26,
    })
    expect(second.error).toBeNull()
    expect(second.data).toBe(recordId)

    // Fields are replaced, not merged: what the form last posted is the record.
    const revised = await recordRow(recordId)
    expect(revised.data!.air_temp_c).toBeNull()
    expect(Number(revised.data!.water_temp_c)).toBe(26)
    expect(revised.data!.wildlife).toEqual([])
  })

  it('refuses a date nobody could have observed', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: NEXT_WEEK,
      p_air_temp_c: 30,
    })
    expect(error?.message).toContain('almanac_obs_date_in_future')
  })

  // The client sends a date in the shop's timezone and the database clock is
  // UTC, so a same-day record filed before 08:00 in Taipei arrives dated
  // "tomorrow". Refusing it would break every early-morning submission.
  it('accepts tomorrow, absorbing the shop-to-database timezone offset', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: TOMORROW, p_water_temp_c: 26,
    })
    expect(error).toBeNull()
  })

  it('refuses to revise a record staff have already ruled on', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_air_temp_c: 28,
    })
    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_almanac_record', {
      p_record_id: filed.data as string,
      p_status: 'approved',
    })

    const { error } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_air_temp_c: 99,
    })
    expect(error?.message).toContain('almanac_record_already_reviewed')
  })
})

describe('almanac trash readings', () => {
  it('files a count with the materials beside it', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)

    const { data, error } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: YESTERDAY,
      p_trash_count: 12,
      p_trash_kinds: ['plastic', 'fishing_gear'],
    })
    expect(error).toBeNull()

    const row = await recordRow(data as string)
    expect(row.data!.trash_count).toBe(12)
    expect(row.data!.trash_kinds).toEqual(['plastic', 'fishing_gear'])
  })

  // The distinction the whole feature rests on: a blank field is "did not
  // look", a zero is "looked, and it was clean". Stored as the same thing,
  // every average would quietly be taken over the dirty days only.
  it('keeps "did not look" and "looked, saw none" apart', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)

    const blank = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY,
    })
    expect((await recordRow(blank.data as string)).data!.trash_count).toBeNull()

    const zero = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_trash_count: 0,
    })
    expect(zero.error).toBeNull()
    expect((await recordRow(zero.data as string)).data!.trash_count).toBe(0)
  })

  it('drops materials the diver left behind after correcting the count to zero', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)

    const { data, error } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: YESTERDAY,
      p_trash_count: 0,
      p_trash_kinds: ['plastic'],
    })
    expect(error).toBeNull()
    expect((await recordRow(data as string)).data!.trash_kinds).toEqual([])
  })

  it('refuses a negative count and a material outside the vocabulary', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)

    const negative = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_trash_count: -3,
    })
    expect(negative.error).not.toBeNull()

    const invented = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_trash_kinds: ['unobtainium'],
    })
    expect(invented.error).not.toBeNull()
  })

  it('publishes both through the read RPC once approved', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const { data: id } = await client.rpc('submit_almanac_record', {
      p_site_id: siteId,
      p_obs_date: YESTERDAY,
      p_trash_count: 7,
      p_trash_kinds: ['styrofoam'],
    })
    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_almanac_record', {
      p_record_id: id as string, p_status: 'approved',
    })

    const { data: rows } = await client.rpc('almanac_records_in_range', {
      p_from: YESTERDAY, p_to: TODAY,
    })
    const mine = (rows ?? []).find(r => r.id === id)!
    expect(mine.trash_count).toBe(7)
    expect(mine.trash_kinds).toEqual(['styrofoam'])
  })
})

describe('almanac_records visibility', () => {
  it('keeps a pending record to its author and staff', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: TODAY, p_visibility_m: 18,
    })
    const recordId = filed.data as string

    const own = await client.from('almanac_records').select('id').eq('id', recordId)
    expect(own.data).toHaveLength(1)

    const stranger = await userClient(otherDiver.email, otherDiver.password)
    const unseen = await stranger.from('almanac_records').select('id').eq('id', recordId)
    expect(unseen.data).toHaveLength(0)

    const staffClient = await userClient(staff.email, staff.password)
    const seen = await staffClient.from('almanac_records').select('id').eq('id', recordId)
    expect(seen.data).toHaveLength(1)
  })

  it('publishes only approved records through almanac_records_in_range', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const pending = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_visibility_m: 12,
    })
    const stranger = await userClient(otherDiver.email, otherDiver.password)

    const window = { p_from: YESTERDAY, p_to: TODAY }
    const before = await stranger.rpc('almanac_records_in_range', window)
    expect(before.data).toHaveLength(0)

    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_almanac_record', {
      p_record_id: pending.data as string,
      p_status: 'approved',
    })

    const after = await stranger.rpc('almanac_records_in_range', window)
    expect(after.data).toHaveLength(1)
    expect(after.data![0].site_id).toBe(siteId)
    expect(after.data![0].diver_display).toBe('Almanac Diver')
  })
})

describe('almanac moderation', () => {
  it('is staff-only, and stamps who ruled', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_air_temp_c: 31,
    })
    const recordId = filed.data as string

    const queueAsDiver = await client.rpc('almanac_pending_records')
    expect(queueAsDiver.error).not.toBeNull()

    const selfApprove = await client.rpc('moderate_almanac_record', {
      p_record_id: recordId, p_status: 'approved',
    })
    expect(selfApprove.error).not.toBeNull()

    const staffClient = await userClient(staff.email, staff.password)
    const queue = await staffClient.rpc('almanac_pending_records')
    expect(queue.error).toBeNull()
    expect(queue.data!.some(r => r.id === recordId)).toBe(true)

    const ruling = await staffClient.rpc('moderate_almanac_record', {
      p_record_id: recordId, p_status: 'rejected', p_staff_notes: 'duplicate',
    })
    expect(ruling.error).toBeNull()

    const ruled = await recordRow(recordId)
    expect(ruled.data!.status).toBe('rejected')
    expect(ruled.data!.approved_by).toBe(staff.id)
    expect(ruled.data!.approved_at).not.toBeNull()
    expect(ruled.data!.staff_notes).toBe('duplicate')
  })

  it('refuses a status outside the review vocabulary', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_air_temp_c: 27,
    })
    const staffClient = await userClient(staff.email, staff.password)
    const { error } = await staffClient.rpc('moderate_almanac_record', {
      p_record_id: filed.data as string,
      p_status: 'pending' as never,
    })
    expect(error?.message).toContain('almanac_status_must_be_approved_or_rejected')
  })
})

describe('dive_sites catalog', () => {
  it('is admin-curated and diver-readable', async () => {
    const client = await userClient(diver.email, diver.password)

    const read = await client.from('dive_sites').select('id').eq('id', siteId)
    expect(read.data).toHaveLength(1)

    const write = await client.from('dive_sites').insert({
      name: 'Diver-invented site', kind: 'dive',
    } as never)
    expect(write.error).not.toBeNull()
  })

  it('refuses the same name twice for a kind, whatever the casing', async () => {
    const name = `Twice ${crypto.randomUUID().slice(0, 8)}`
    const first = await admin.from('dive_sites').insert({ name, kind: 'dive' } as never).select('id').single()
    expect(first.error).toBeNull()

    const clash = await admin.from('dive_sites').insert({ name: name.toUpperCase(), kind: 'dive' } as never)
    expect(clash.error).not.toBeNull()

    // The same name for the other kind is a different place, and allowed.
    const otherKind = await admin.from('dive_sites').insert({ name, kind: 'adventure' } as never).select('id').single()
    expect(otherKind.error).toBeNull()

    await admin.from('dive_sites').delete().eq('id', (first.data as { id: string }).id)
    await admin.from('dive_sites').delete().eq('id', (otherKind.data as { id: string }).id)
  })

  it('will not let a site with observations be deleted', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    await client.rpc('submit_almanac_record', {
      p_site_id: siteId, p_obs_date: YESTERDAY, p_air_temp_c: 26,
    })

    const { error } = await admin.from('dive_sites').delete().eq('id', siteId)
    expect(error).not.toBeNull()
  })
})
