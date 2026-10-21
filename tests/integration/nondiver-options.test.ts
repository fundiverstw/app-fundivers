import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

// Pins the non-diver options schema (20261021100000):
//   1. The catalog is admin-written and readable by everyone, guests included
//      (the register form renders it before a guest has an account).
//   2. Its constraints refuse a blank name, a negative price and a zero deposit.
//   3. set_event_relations attaches options to an event and reconciles them.
//   4. A diver can read which options an event offers but cannot change them.
//   5. Deleting an option withdraws it from every event.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
let diveId: string
const optionIds: string[] = []

async function makeOption(label: string, price = 1500, deposit: number | null = null): Promise<string> {
  const { data, error } = await admin.from('nondiver_options' as never)
    .insert({ label, price, deposit_amount: deposit } as never)
    .select('id').single()
  if (error) throw error
  const id = (data as { id: string }).id
  optionIds.push(id)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
  diveId    = await createTestDive(admin)
})

afterAll(async () => {
  if (optionIds.length) await admin.from('nondiver_options' as never).delete().in('id', optionIds)
  if (diveId) await deleteTestDive(admin, diveId)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('nondiver_options catalog', () => {
  it('lets an admin create an option', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    const { data, error } = await sb.from('nondiver_options')
      .insert({ label: 'Snorkeler', price: 1500, deposit_amount: 500 })
      .select('id').single()
    expect(error).toBeNull()
    optionIds.push((data as { id: string }).id)
  })

  it('refuses a diver writing the catalog', async () => {
    const sb = await userClient(diver.email, diver.password)
    const { error } = await sb.from('nondiver_options').insert({ label: 'Free ride', price: 0 })
    expect(error).not.toBeNull()
  })

  it('is readable by a diver', async () => {
    const id = await makeOption('Boat passenger', 800)
    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('nondiver_options').select('id, price').eq('id', id)
    expect(error).toBeNull()
    expect(data).toEqual([{ id, price: 800 }])
  })

  it('refuses a blank name, a negative price and a zero deposit', async () => {
    const bad = [
      { label: '   ', price: 100 },
      { label: 'Negative', price: -1 },
      { label: 'Zero deposit', price: 100, deposit_amount: 0 },
    ]
    for (const row of bad) {
      const { error } = await admin.from('nondiver_options' as never).insert(row as never)
      expect(error, JSON.stringify(row)).not.toBeNull()
    }
  })
})

describe('event_nondiver_options via set_event_relations', () => {
  it('attaches options to an event and reconciles on re-call', async () => {
    const [o1, o2] = [await makeOption('Snorkeler A'), await makeOption('Snorkeler B')]
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('set_event_relations', {
      p_event_id: diveId, p_nondiver_option_ids: [o1, o2],
    })
    expect(error).toBeNull()
    const first = await admin.from('event_nondiver_options').select('option_id').eq('event_id', diveId)
    expect((first.data ?? []).map(r => r.option_id).sort()).toEqual([o1, o2].sort())

    const { error: err2 } = await sb.rpc('set_event_relations', {
      p_event_id: diveId, p_nondiver_option_ids: [o2],
    })
    expect(err2).toBeNull()
    const second = await admin.from('event_nondiver_options').select('option_id').eq('event_id', diveId)
    expect((second.data ?? []).map(r => r.option_id)).toEqual([o2])
  })

  it('lets a diver read what an event offers but not change it', async () => {
    const o = await makeOption('Readable option')
    const adminSb = await userClient(adminUser.email, adminUser.password)
    await adminSb.rpc('set_event_relations', { p_event_id: diveId, p_nondiver_option_ids: [o] })

    const sb = await userClient(diver.email, diver.password)
    const read = await sb.from('event_nondiver_options').select('option_id').eq('event_id', diveId)
    expect(read.error).toBeNull()
    expect((read.data ?? []).map(r => r.option_id)).toContain(o)

    const viaRpc = await sb.rpc('set_event_relations', { p_event_id: diveId, p_nondiver_option_ids: [] })
    expect(viaRpc.error).not.toBeNull()
    const direct = await sb.from('event_nondiver_options').insert({ event_id: diveId, option_id: o })
    expect(direct.error).not.toBeNull()
  })

  it('withdraws a deleted option from every event', async () => {
    const o = await makeOption('Short-lived option')
    const sb = await userClient(adminUser.email, adminUser.password)
    await sb.rpc('set_event_relations', { p_event_id: diveId, p_nondiver_option_ids: [o] })
    const { error } = await sb.from('nondiver_options').delete().eq('id', o)
    expect(error).toBeNull()
    const { data } = await admin.from('event_nondiver_options').select('option_id').eq('option_id', o)
    expect(data ?? []).toEqual([])
  })
})
