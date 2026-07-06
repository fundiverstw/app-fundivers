import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { adminClient, createTestUser, createTestDive, deleteTestUser, deleteTestDive, type TestUser } from './helpers'

// The capacity-suffix trigger (migration 20260514020000) maintains
// events.display_title as `base + suffix`.
// Suffix is driven by capacity + status='confirmed' booking count, so
// these tests insert / move bookings and read display_title back.

const admin = adminClient()
let diverA: TestUser
let diverB: TestUser
let diverC: TestUser
let diveId: string

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
  diverC = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  if (diverA) await deleteTestUser(admin, diverA.id)
  if (diverB) await deleteTestUser(admin, diverB.id)
  if (diverC) await deleteTestUser(admin, diverC.id)
})

beforeEach(async () => {
  diveId = await createTestDive(admin)
  await admin.from('events').update({ display_title: 'Test Dive' } as never).eq('id', diveId)
})

async function fetchTitle(): Promise<string | null> {
  const { data } = await admin.from('events').select('display_title').eq('id', diveId).single<{ display_title: string | null }>()
  return data?.display_title ?? null
}

async function insertBooking(userId: string, statusOverride?: 'pending' | 'confirmed' | 'waitlisted') {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId,
    event_id: diveId,
    details: {},
    ...(statusOverride ? { status: statusOverride } : {}),
  } as never).select('id, status').single<{ id: string; status: string }>()
  if (error) throw error
  return data!
}

describe('display_title capacity suffix trigger', () => {
  afterAll(async () => {
    // diveId rotates per test, but deleteTestDive in each block is cheaper
    // than orphans piling up — clean the last one.
    if (diveId) await deleteTestDive(admin, diveId).catch(() => { /* ignore */ })
  })

  it('leaves the title untouched when capacity is null (uncapped)', async () => {
    const b = await insertBooking(diverA.id, 'confirmed')
    expect(await fetchTitle()).toBe('Test Dive')
    await admin.from('bookings').delete().eq('id', b.id)
  })

  it("leaves the title untouched when capacity=3 and no confirmed bookings (plenty of room)", async () => {
    await admin.from('events').update({ capacity: 3 } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Test Dive')
  })

  it("shows ' (2 spots open)' after one confirmed booking against capacity=3", async () => {
    await admin.from('events').update({ capacity: 3 } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Test Dive')

    const b = await insertBooking(diverA.id, 'confirmed')
    expect(await fetchTitle()).toBe('Test Dive (2 spots open)')

    await admin.from('bookings').delete().eq('id', b.id)
  })

  it("shows ' (1 spot open)' / ' (fully booked -- register for waitlist)' as confirms climb", async () => {
    await admin.from('events').update({ capacity: 2 } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Test Dive (2 spots open)')

    const a = await insertBooking(diverA.id, 'confirmed')
    expect(await fetchTitle()).toBe('Test Dive (1 spot open)')

    const b = await insertBooking(diverB.id, 'confirmed')
    expect(await fetchTitle()).toBe('Test Dive (fully booked -- register for waitlist)')

    // Pending booking does NOT consume a spot, suffix stays.
    const c = await insertBooking(diverC.id)
    expect(c.status).toBe('waitlisted') // event is full → waitlist trigger fires
    expect(await fetchTitle()).toBe('Test Dive (fully booked -- register for waitlist)')

    // Cancel one confirmed → suffix drops back to "1 spot open".
    // (Waitlist offer machinery also fires; we don't care about that here.)
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', a.id)
    expect(await fetchTitle()).toBe('Test Dive (1 spot open)')

    await admin.from('bookings').delete().in('id', [a.id, b.id, c.id])
  })

  it("strips a prior suffix on capacity edit and reapplies the correct one", async () => {
    await admin.from('events').update({ capacity: 2 } as never).eq('id', diveId)
    const a = await insertBooking(diverA.id, 'confirmed')
    expect(await fetchTitle()).toBe('Test Dive (1 spot open)')

    // Raise capacity → remaining = 4, no suffix.
    await admin.from('events').update({ capacity: 5 } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Test Dive')

    await admin.from('bookings').delete().eq('id', a.id)
  })

  it("recovers when admin re-saves with the stale suffix still in display_title", async () => {
    await admin.from('events').update({ capacity: 2 } as never).eq('id', diveId)
    const a = await insertBooking(diverA.id, 'confirmed')
    expect(await fetchTitle()).toBe('Test Dive (1 spot open)')

    // Simulate admin re-saving the polluted title — trigger should strip
    // and re-append, NOT double-stack the suffix.
    await admin.from('events').update({ display_title: 'Test Dive (1 spot open)' } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Test Dive (1 spot open)')

    // Admin changes the base title.
    await admin.from('events').update({ display_title: 'Renamed Dive (1 spot open)' } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Renamed Dive (1 spot open)')

    await admin.from('bookings').delete().eq('id', a.id)
  })

  it("honors manual fully_booked even without capacity set", async () => {
    await admin.from('events').update({ fully_booked: true } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Test Dive (fully booked -- register for waitlist)')

    await admin.from('events').update({ fully_booked: false } as never).eq('id', diveId)
    expect(await fetchTitle()).toBe('Test Dive')
  })
})
