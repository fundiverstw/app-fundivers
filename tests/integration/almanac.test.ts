// Integration tests for the almanac (20260818000000) — crowdsourced condition
// records that only reach the crowd once staff approve them. What we lock in:
//   1. The table is read-only to `authenticated`: every write goes through an
//      RPC, so a diver cannot mint an already-approved record.
//   2. submit_almanac_record files a pending record and revises it in place,
//      but refuses a future date and refuses to reopen a reviewed record.
//   3. A pending record is visible to its author and to staff, and to nobody
//      else — approved ones are visible to all.
//   4. The review queue and the ruling RPC are staff/admin only.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let staff: TestUser
let diver: TestUser
let otherDiver: TestUser
let eventId: string

const TODAY = new Date().toLocaleDateString('en-CA')
const YESTERDAY = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')
const TOMORROW = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA')

async function clearRecords() {
  await admin.from('almanac_records').delete().eq('event_id', eventId)
}

function recordRow(id: string) {
  return admin.from('almanac_records').select('*').eq('id', id).single()
}

beforeAll(async () => {
  staff = await createTestUser(admin, { role: 'staff' })
  diver = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
  eventId = await createTestDive(admin)
  await admin.from('profiles').update({ name: 'Almanac Diver' } as never).eq('id', diver.id)
})

afterAll(async () => {
  await clearRecords()
  await deleteTestDive(admin, eventId)
  for (const u of [staff, diver, otherDiver]) await deleteTestUser(admin, u.id)
})

describe('almanac_records writes', () => {
  it('refuses a direct insert from a diver — writes are RPC-only', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.from('almanac_records').insert({
      diver_id: diver.id,
      event_id: eventId,
      obs_date: YESTERDAY,
      status: 'approved',
    } as never)
    expect(error).not.toBeNull()
  })

  it('files a pending record and revises it in place', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)

    const first = await client.rpc('submit_almanac_record', {
      p_event_id: eventId,
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
      p_event_id: eventId,
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

  it('refuses an observation dated in the future', async () => {
    const client = await userClient(diver.email, diver.password)
    const { error } = await client.rpc('submit_almanac_record', {
      p_event_id: eventId,
      p_obs_date: TOMORROW,
      p_air_temp_c: 30,
    })
    expect(error?.message).toContain('almanac_obs_date_in_future')
  })

  it('refuses to revise a record staff have already ruled on', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_event_id: eventId, p_obs_date: YESTERDAY, p_air_temp_c: 28,
    })
    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_almanac_record', {
      p_record_id: filed.data as string,
      p_status: 'approved',
    })

    const { error } = await client.rpc('submit_almanac_record', {
      p_event_id: eventId, p_obs_date: YESTERDAY, p_air_temp_c: 99,
    })
    expect(error?.message).toContain('almanac_record_already_reviewed')
  })
})

describe('almanac_records visibility', () => {
  it('keeps a pending record to its author and staff', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_event_id: eventId, p_obs_date: TODAY, p_visibility_m: 18,
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

  it('publishes only approved records through almanac_records_for_events', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const pending = await client.rpc('submit_almanac_record', {
      p_event_id: eventId, p_obs_date: YESTERDAY, p_visibility_m: 12,
    })
    const stranger = await userClient(otherDiver.email, otherDiver.password)

    const before = await stranger.rpc('almanac_records_for_events', { p_event_ids: [eventId] })
    expect(before.data).toHaveLength(0)

    const staffClient = await userClient(staff.email, staff.password)
    await staffClient.rpc('moderate_almanac_record', {
      p_record_id: pending.data as string,
      p_status: 'approved',
    })

    const after = await stranger.rpc('almanac_records_for_events', { p_event_ids: [eventId] })
    expect(after.data).toHaveLength(1)
    expect(after.data![0].event_id).toBe(eventId)
    expect(after.data![0].diver_display).toBe('Almanac Diver')
  })
})

describe('almanac moderation', () => {
  it('is staff-only, and stamps who ruled', async () => {
    await clearRecords()
    const client = await userClient(diver.email, diver.password)
    const filed = await client.rpc('submit_almanac_record', {
      p_event_id: eventId, p_obs_date: YESTERDAY, p_air_temp_c: 31,
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
      p_event_id: eventId, p_obs_date: YESTERDAY, p_air_temp_c: 27,
    })
    const staffClient = await userClient(staff.email, staff.password)
    const { error } = await staffClient.rpc('moderate_almanac_record', {
      p_record_id: filed.data as string,
      p_status: 'pending' as never,
    })
    expect(error?.message).toContain('almanac_status_must_be_approved_or_rejected')
  })
})
