import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { world, ledger, teardownWorld, type World, type Ledger } from './world'

// A parent books the family in and pays for everyone with one transfer.
//
// Three rules have to hold together for this to be safe, and each is enforced in
// a different place: who may be named as the payer (a trigger), who may read
// whose row (RLS), and how one lump sum is spread across the group (an RPC that
// covers deposits before balances, oldest booking first). The journey is the
// parent handing over money once and every child ending up confirmed.

let w: World
const l: Ledger = ledger()

beforeAll(async () => { w = await world(l) })
afterAll(async () => { await teardownWorld(l) })

describe('scenario: a parent books two children and pays the lot', () => {
  it('covers every deposit first and confirms all three spots', async () => {
    const parent = await w.person('diver')
    const kidA = await w.person('diver')
    const kidB = await w.person('diver')
    await w.family(parent, [kidA, kidB])

    const eventId = await w.dive()
    const { groupId, bookingIds } = await w.groupBooking({
      lead: parent, members: [kidA, kidB], eventId, total: 6000, deposit: 2000,
    })

    // Nothing paid: three pending spots.
    for (const id of bookingIds) expect(await w.bookingStatus(id)).toBe('pending')

    // The parent transfers exactly the three deposits.
    expect(await w.payForGroup({ lead: parent, amount: 6000, groupId })).toBe(6000)

    for (const id of bookingIds) {
      expect(await w.paidOn(id)).toBe(2000)
      // A covered deposit is what confirms a spot — for the children too.
      expect(await w.bookingStatus(id)).toBe('confirmed')
    }
  })

  it('spends the rest against balances and clamps to what is owed', async () => {
    const parent = await w.person('diver')
    const kid = await w.person('diver')
    await w.family(parent, [kid])

    const eventId = await w.dive()
    const { groupId, bookingIds } = await w.groupBooking({
      lead: parent, members: [kid], eventId, total: 6000, deposit: 2000,
    })

    // Two bookings at 6000 each = 12000 outstanding. Overpay wildly.
    const applied = await w.payForGroup({ lead: parent, amount: 99_000, groupId })
    expect(applied).toBe(12_000)

    for (const id of bookingIds) expect(await w.paidOn(id)).toBe(6000)

    // Nothing is owed now, so a second transfer moves nothing.
    expect(await w.payForGroup({ lead: parent, amount: 5000, groupId })).toBe(0)
  })

  it('pays the oldest booking first when the money runs out partway', async () => {
    const parent = await w.person('diver')
    const kidA = await w.person('diver')
    const kidB = await w.person('diver')
    await w.family(parent, [kidA, kidB])

    const eventId = await w.dive()
    // groupBooking staggers created_at: parent, then kidA, then kidB.
    const { groupId, bookingIds } = await w.groupBooking({
      lead: parent, members: [kidA, kidB], eventId, total: 6000, deposit: 2000,
    })

    // Enough for two deposits, not three.
    expect(await w.payForGroup({ lead: parent, amount: 4000, groupId })).toBe(4000)

    expect(await w.paidOn(bookingIds[0])).toBe(2000)
    expect(await w.paidOn(bookingIds[1])).toBe(2000)
    expect(await w.paidOn(bookingIds[2])).toBe(0)
    // The unfunded child is still waiting for a spot.
    expect(await w.bookingStatus(bookingIds[2])).toBe('pending')
  })
})

describe('scenario: who is allowed to pay for whom', () => {
  it('accepts the diver themselves and their parent as payer', async () => {
    const parent = await w.person('diver')
    const kid = await w.person('diver')
    await w.family(parent, [kid])

    // A dive each: bookings_one_active_per_user_idx allows the same diver only
    // one live booking per event, so reusing one dive would fail for that
    // reason rather than the payer rule under test.
    for (const payer of [kid, parent]) {
      const eventId = await w.dive()
      const { error } = await w.admin.from('bookings').insert({
        user_id: kid.id, event_id: eventId, status: 'pending',
        details: { total: 3000, deposit: 1000 }, payer_id: payer.id,
      } as never)
      expect(error).toBeNull()
    }
  })

  // Enforced by a trigger, so it holds even under the service role — a client
  // that skipped the UI could not name an unrelated diver as the payer.
  it('refuses a payer who is neither the diver nor their parent', async () => {
    const kid = await w.person('diver')
    const stranger = await w.person('diver')
    const eventId = await w.dive()

    const { error } = await w.admin.from('bookings').insert({
      user_id: kid.id, event_id: eventId, status: 'pending',
      details: { total: 3000, deposit: 1000 }, payer_id: stranger.id,
    } as never)
    expect(error).not.toBeNull()
    expect(error?.message).toMatch(/payer_id must be/i)
  })

  it('is admin-only: the parent cannot run the group payment themselves', async () => {
    const parent = await w.person('diver')
    const kid = await w.person('diver')
    await w.family(parent, [kid])
    const eventId = await w.dive()
    const { groupId, bookingIds } = await w.groupBooking({
      lead: parent, members: [kid], eventId,
    })

    const asParent = await w.as(parent)
    const { error } = await asParent.rpc('record_group_payment', {
      p_lead: parent.id, p_amount: 4000, p_reference: 'GRP-1', p_group_id: groupId,
    })
    expect(error).not.toBeNull()
    // And no money moved.
    for (const id of bookingIds) expect(await w.paidOn(id)).toBe(0)
  })
})

describe('scenario: what the family can see of each other', () => {
  it('a child can read their own parent and nobody else', async () => {
    const parent = await w.person('diver')
    const kid = await w.person('diver')
    const stranger = await w.person('diver')
    await w.family(parent, [kid])

    const asKid = await w.as(kid)
    const { data: ownParent } = await asKid.from('profiles').select('id').eq('id', parent.id)
    expect((ownParent ?? []).map(r => (r as { id: string }).id)).toEqual([parent.id])

    const { data: other } = await asKid.from('profiles').select('id').eq('id', stranger.id)
    expect(other ?? []).toEqual([])
  })

  it('a parent sees the bookings they are paying for', async () => {
    const parent = await w.person('diver')
    const kid = await w.person('diver')
    await w.family(parent, [kid])
    const eventId = await w.dive()
    const { bookingIds } = await w.groupBooking({ lead: parent, members: [kid], eventId })

    const asParent = await w.as(parent)
    const { data } = await asParent.from('bookings').select('id').in('id', bookingIds)
    // Both their own and the child's, since they are on the hook for both.
    expect((data ?? []).length).toBe(2)
  })
})
