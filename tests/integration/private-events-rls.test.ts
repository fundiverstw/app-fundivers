import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

// Private events must not be readable by the public. `events public select`
// used to be USING (true), so anyone holding the anon key — which ships in the
// SPA bundle — could read every private event straight off PostgREST; the only
// thing hiding them was a client-side query filter. See
// 20260811000000_restrict_private_events_to_participants.sql.
//
// The people who legitimately read one are pinned here too, because the easy
// wrong fix (hide private events from everyone but staff) silently breaks the
// bookings page for the diver who is actually going.

const admin = adminClient()
let adminUser: TestUser
let staffUser: TestUser
let outsider: TestUser
let attendee: TestUser
let parent: TestUser
let child: TestUser
let privateEventId: string
let publicEventId: string

async function createEvent(isPrivate: boolean): Promise<string> {
  const id = crypto.randomUUID()
  const startDate = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const { error } = await admin.from('events' as never).insert({
    id,
    kind: 'dive',
    admin_title: isPrivate ? 'PRIVATE charter' : 'Public dive',
    display_title: isPrivate ? 'PRIVATE charter' : 'Public dive',
    start_date: startDate,
    end_date: startDate,
    start_time: '09:00:00',
    is_private: isPrivate,
  } as never)
  if (error) throw new Error(`createEvent failed: ${error.message}`)
  return id
}

/** Can this client see the private event? */
async function seesPrivate(sb: Awaited<ReturnType<typeof userClient>> | ReturnType<typeof anonClient>) {
  const { data } = await sb.from('events').select('id').eq('id', privateEventId)
  return (data ?? []).length === 1
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  staffUser = await createTestUser(admin, { role: 'staff' })
  outsider  = await createTestUser(admin, { role: 'diver' })
  attendee  = await createTestUser(admin, { role: 'diver' })
  parent    = await createTestUser(admin, { role: 'diver' })
  child     = await createTestUser(admin, { role: 'diver' })

  await admin.from('profiles').update({ parent_account: parent.id } as never).eq('id', child.id)

  privateEventId = await createEvent(true)
  publicEventId  = await createEvent(false)

  for (const userId of [attendee.id, child.id]) {
    const { error } = await admin.from('bookings' as never).insert({
      user_id: userId, event_id: privateEventId, status: 'pending', details: {},
    } as never)
    if (error) throw new Error(`booking insert failed: ${error.message}`)
  }
})

afterAll(async () => {
  await admin.from('bookings' as never).delete().eq('event_id', privateEventId)
  for (const id of [privateEventId, publicEventId]) {
    await admin.from('events' as never).delete().eq('id', id)
  }
  for (const u of [adminUser, staffUser, outsider, attendee, parent, child]) {
    if (u) await deleteTestUser(admin, u.id)
  }
})

describe('private events are not public', () => {
  it('a logged-out visitor cannot read a private event', async () => {
    expect(await seesPrivate(anonClient())).toBe(false)
  })

  it('a logged-out visitor can still read the public catalogue', async () => {
    const { data } = await anonClient().from('events').select('id').eq('id', publicEventId)
    expect(data).toHaveLength(1)
  })

  // The original bug: filtering client-side leaves the row addressable
  // directly. Ask for private events explicitly, the way an attacker would.
  it('asking PostgREST for private events directly returns nothing to anon', async () => {
    const { data } = await anonClient().from('events').select('id, display_title').eq('is_private', true)
    expect(data).toEqual([])
  })

  it('a signed-in diver with no booking cannot read it', async () => {
    const sb = await userClient(outsider.email, outsider.password)
    expect(await seesPrivate(sb)).toBe(false)
  })
})

describe('private events stay visible to their participants', () => {
  it('the booked diver can read it', async () => {
    const sb = await userClient(attendee.email, attendee.password)
    expect(await seesPrivate(sb)).toBe(true)
  })

  it('the parent of a booked child can read it', async () => {
    const sb = await userClient(parent.email, parent.password)
    expect(await seesPrivate(sb)).toBe(true)
  })

  it('staff can read it', async () => {
    const sb = await userClient(staffUser.email, staffUser.password)
    expect(await seesPrivate(sb)).toBe(true)
  })

  it('an admin can read it', async () => {
    const sb = await userClient(adminUser.email, adminUser.password)
    expect(await seesPrivate(sb)).toBe(true)
  })
})
