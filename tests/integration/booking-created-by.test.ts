// Who registered this diver? The answer has to survive being disputed, so it is
// derived from the session that made the row rather than accepted from it.
//
// Three insert paths need three different answers — a diver or admin posting
// straight to PostgREST, a SECURITY DEFINER RPC, and create-registration
// running as service_role after it has verified a Bearer token — and only the
// first two can be exercised here. The edge-function path is covered by
// create-registration's own handler test.
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let diver: TestUser
let other: TestUser
let child: TestUser
let adminUser: TestUser
const bookingIds: string[] = []
const diveIds: string[] = []

beforeAll(async () => {
  diver = await createTestUser(admin, { role: 'diver' })
  other = await createTestUser(admin, { role: 'diver' })
  adminUser = await createTestUser(admin, { role: 'admin' })
  child = await createTestUser(admin, { role: 'diver' })
  const { error } = await admin.from('profiles')
    .update({ parent_account: diver.id } as never).eq('id', child.id)
  if (error) throw new Error(error.message)
})

afterAll(async () => {
  if (bookingIds.length) await admin.from('bookings').delete().in('id', bookingIds)
  for (const id of diveIds) await deleteTestDive(admin, id)
  for (const u of [child, diver, other, adminUser]) {
    if (u) await deleteTestUser(admin, u.id).catch(() => {})
  }
})

async function freshDive(): Promise<string> {
  const id = await createTestDive(admin)
  diveIds.push(id)
  return id
}

function track(id: string): string {
  bookingIds.push(id)
  return id
}

async function createdByOf(bookingId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('bookings').select('created_by').eq('id', bookingId).single()
  if (error) throw new Error(error.message)
  return (data as { created_by: string | null }).created_by
}

describe('bookings.created_by', () => {
  it('stamps the diver who registered themselves', async () => {
    const dive = await freshDive()
    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('bookings')
      .insert({ user_id: diver.id, event_id: dive, status: 'pending' })
      .select('id').single()
    expect(error).toBeNull()
    const id = track((data as { id: string }).id)

    // created_by = user_id is the shape every surface reads as "registered
    // themselves". No badge, nobody to name.
    expect(await createdByOf(id)).toBe(diver.id)
  })

  it('stamps the parent who registered a child', async () => {
    // The only on-behalf insert PostgREST allows: "bookings: parent insert for
    // children". An admin adding a diver cannot reach the table directly at all
    // — no policy admits it — which is why Add diver goes through
    // create-registration and why that path is the one that supplies the value.
    const dive = await freshDive()
    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('bookings')
      .insert({ user_id: child.id, event_id: dive, status: 'pending' })
      .select('id').single()
    expect(error).toBeNull()
    const id = track((data as { id: string }).id)

    expect(await createdByOf(id)).toBe(diver.id)
  })

  it('ignores a created_by the caller sends', async () => {
    // The whole point: a diver who could write this column could claim the shop
    // signed them up for something they booked themselves.
    const dive = await freshDive()
    const sb = await userClient(diver.email, diver.password)
    const { data, error } = await sb.from('bookings')
      .insert({ user_id: diver.id, event_id: dive, status: 'pending', created_by: adminUser.id })
      .select('id').single()
    expect(error).toBeNull()
    const id = track((data as { id: string }).id)

    expect(await createdByOf(id)).toBe(diver.id)
  })

  it('does not move when the booking is edited', async () => {
    const dive = await freshDive()
    const { data } = await admin.from('bookings')
      .insert({ user_id: diver.id, event_id: dive, status: 'pending', created_by: adminUser.id } as never)
      .select('id').single()
    const id = track((data as { id: string }).id)

    const diverSb = await userClient(diver.email, diver.password)
    const { error } = await diverSb.from('bookings')
      .update({ status: 'cancelled', created_by: diver.id }).eq('id', id)
    expect(error).toBeNull()

    // Who created it is a fact about the past. Cancelling does not rewrite it,
    // and the update's own attempt to set it is discarded.
    expect(await createdByOf(id)).toBe(adminUser.id)
  })

  it('takes the value service_role supplies, which is create-registration\'s path', async () => {
    // auth.uid() is null here, so the trigger has nothing of its own to stamp
    // and trusts the caller — safe only because create-registration resolves it
    // from a verified Bearer token before inserting.
    const dive = await freshDive()
    const { data, error } = await admin.from('bookings')
      .insert({ user_id: diver.id, event_id: dive, status: 'pending', created_by: other.id } as never)
      .select('id').single()
    expect(error).toBeNull()
    const id = track((data as { id: string }).id)

    expect(await createdByOf(id)).toBe(other.id)
  })

  it('leaves it null when nobody can be named', async () => {
    // The guest path: the registrant had no account until the request that made
    // the booking, so there is no id to record.
    const dive = await freshDive()
    const { data, error } = await admin.from('bookings')
      .insert({ user_id: diver.id, event_id: dive, status: 'pending' })
      .select('id').single()
    expect(error).toBeNull()
    const id = track((data as { id: string }).id)

    expect(await createdByOf(id)).toBeNull()
  })
})
