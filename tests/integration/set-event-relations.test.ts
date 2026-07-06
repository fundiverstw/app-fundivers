import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  createTestCourse, deleteTestCourse,
  type TestUser,
} from './helpers'

// Pins the set_event_relations RPC — the single source of truth for an event's
// room / add-on / destination junction rows (it replaced the old
// string-column write-buffer + sync triggers). Covers:
//   1. Admin writes all four junctions via the RPC (dive: rooms/addons/dests;
//      course: addons), and re-calling reconciles (delete-then-insert).
//   2. RLS: the RPC is SECURITY INVOKER, so a diver calling it (or writing the
//      junctions directly) is blocked by the is_admin() junction policies.
//   3. Public read: an authenticated diver can read the junctions (the
//      src/lib/events.ts path).
//   4. FK integrity: an unknown id rolls the whole call back.

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
let diveId: string
let courseId: string
const roomIds: string[] = []
const addonIds: string[] = []
const destIds: string[] = []

async function makeRoom(name: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('rooms' as never).insert({
    id: id, display_title: name, admin_title: name, added_price: 0, currency: 'TWD',
  } as never)
  if (error) throw error
  roomIds.push(id)
  return id
}
async function makeAddon(name: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('addons' as never).insert({
    id: id, display_title: name, admin_title: name, price: 0, currency: 'TWD',
  } as never)
  if (error) throw error
  addonIds.push(id)
  return id
}
async function makeDestination(name: string): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await admin.from('travel_destinations' as never).insert({
    id: id, admin_title: name, slug: `/test/${id}`, country: 'Testland',
  } as never)
  if (error) throw error
  destIds.push(id)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
  diveId    = await createTestDive(admin)
  courseId  = await createTestCourse(admin)
})

afterAll(async () => {
  if (roomIds.length)  await admin.from('rooms' as never).delete().in('id', roomIds)
  if (addonIds.length) await admin.from('addons' as never).delete().in('id', addonIds)
  if (destIds.length)  await admin.from('travel_destinations' as never).delete().in('id', destIds)
  if (diveId)   await deleteTestDive(admin, diveId)
  if (courseId) await deleteTestCourse(admin, courseId)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('set_event_relations RPC — admin writes + reconciles junctions', () => {
  it('writes rooms, add-ons, and destinations for a dive, then reconciles on re-call', async () => {
    const [r1, r2] = [await makeRoom('R1'), await makeRoom('R2')]
    const [a1, a2] = [await makeAddon('A1'), await makeAddon('A2')]
    const d1 = await makeDestination('D1')

    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('set_event_relations', {
      p_event_id: diveId,
      p_room_ids: [r1, r2], p_addon_ids: [a1, a2], p_destination_ids: [d1],
    })
    expect(error).toBeNull()

    const rooms = await admin.from('event_rooms').select('room_id').eq('event_id', diveId)
    const addons = await admin.from('event_addons').select('addon_id').eq('event_id', diveId)
    const dests = await admin.from('event_destinations').select('destination_id').eq('event_id', diveId)
    expect((rooms.data ?? []).map(r => r.room_id).sort()).toEqual([r1, r2].sort())
    expect((addons.data ?? []).map(r => r.addon_id).sort()).toEqual([a1, a2].sort())
    expect((dests.data ?? []).map(r => r.destination_id)).toEqual([d1])

    // Re-call with a narrowed set — delete-then-insert reconciles.
    const { error: err2 } = await sb.rpc('set_event_relations', {
      p_event_id: diveId,
      p_room_ids: [r2], p_addon_ids: [], p_destination_ids: [d1],
    })
    expect(err2).toBeNull()
    const rooms2 = await admin.from('event_rooms').select('room_id').eq('event_id', diveId)
    const addons2 = await admin.from('event_addons').select('addon_id').eq('event_id', diveId)
    expect((rooms2.data ?? []).map(r => r.room_id)).toEqual([r2])
    expect((addons2.data ?? []).length).toBe(0)
  })

  it('writes add-ons for a course', async () => {
    const a = await makeAddon('Course addon')
    const sb = await userClient(adminUser.email, adminUser.password)
    const { error } = await sb.rpc('set_event_relations', {
      p_event_id: courseId, p_room_ids: [], p_addon_ids: [a], p_destination_ids: [],
    })
    expect(error).toBeNull()
    const { data } = await admin.from('event_addons').select('addon_id').eq('event_id', courseId)
    expect((data ?? []).map(r => r.addon_id)).toEqual([a])
  })

  it('rolls back the whole call when an id is unknown (FK)', async () => {
    const a = await makeAddon('Good addon')
    const sb = await userClient(adminUser.email, adminUser.password)
    // Seed a known-good add-on first.
    await sb.rpc('set_event_relations', { p_event_id: diveId, p_addon_ids: [a] })
    // Now a call containing a bogus id must fail and leave the good one intact.
    const { error } = await sb.rpc('set_event_relations', {
      p_event_id: diveId, p_addon_ids: [a, crypto.randomUUID()],
    })
    expect(error).not.toBeNull()
    const { data } = await admin.from('event_addons').select('addon_id').eq('event_id', diveId)
    expect((data ?? []).map(r => r.addon_id)).toEqual([a])
  })
})

describe('set_event_relations RPC — RLS', () => {
  it('a diver cannot write junctions via the RPC (SECURITY INVOKER + is_admin policy)', async () => {
    const a = await makeAddon('Diver-blocked via RPC')
    const sb = await userClient(diver.email, diver.password)
    const { error } = await sb.rpc('set_event_relations', {
      p_event_id: diveId, p_addon_ids: [a],
    })
    expect(error).not.toBeNull()
  })

  it('a diver cannot insert directly into event_addons', async () => {
    const a = await makeAddon('Diver-blocked direct')
    const sb = await userClient(diver.email, diver.password)
    const { error } = await sb.from('event_addons').insert({ event_id: diveId, addon_id: a })
    expect(error).not.toBeNull()
  })

  it('an authenticated diver can read the junction rows', async () => {
    const a = await makeAddon('Readable addon')
    const adminSb = await userClient(adminUser.email, adminUser.password)
    await adminSb.rpc('set_event_relations', { p_event_id: courseId, p_addon_ids: [a] })

    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('event_addons').select('addon_id').eq('event_id', courseId)
    expect(error).toBeNull()
    expect((data ?? []).map(r => r.addon_id)).toContain(a)
  })
})
