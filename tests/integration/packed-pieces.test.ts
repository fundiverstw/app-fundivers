import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, anonClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'
import { fetchPackedKeys, writePacked } from '../../src/lib/packed-sync'
import { supabase } from '../../src/lib/supabase'

// The shared pack list (20260928100000) against the live stack: the crew can
// read, tick and untick; a diver and an anonymous visitor can do none of it;
// a tick names the person who made it and cannot name anyone else; and a
// piece two phones tick at once is one row.

const admin = adminClient()
const DAY = '2031-10-04'
let staff: TestUser
let otherStaff: TestUser
let diver: TestUser
let diveId: string
let bookingId: string

beforeAll(async () => {
  staff      = await createTestUser(admin, { role: 'staff' })
  otherStaff = await createTestUser(admin, { role: 'staff' })
  diver      = await createTestUser(admin, { role: 'diver' })
  diveId     = await createTestDive(admin)
  const { data, error } = await admin.from('bookings')
    .insert({ user_id: diver.id, event_id: diveId, status: 'confirmed', details: {} })
    .select('id').single()
  if (error) throw error
  bookingId = data.id
})

afterAll(async () => {
  await supabase.auth.signOut()
  if (diveId) {
    await admin.from('bookings').delete().eq('event_id', diveId)
    await deleteTestDive(admin, diveId)
  }
  for (const u of [staff, otherStaff, diver]) if (u) await deleteTestUser(admin, u.id)
})

describe('packed_pieces', () => {
  it('lets staff tick a piece, stamped with who ticked it', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { error } = await sb.from('packed_pieces').insert({ pack_day: DAY, booking_id: bookingId, item: 'BCD' })
    expect(error).toBeNull()
    const { data } = await admin.from('packed_pieces').select('packed_by').eq('booking_id', bookingId).single()
    expect(data?.packed_by).toBe(staff.id)
  })

  it("lets another crew member read it, and untick it", async () => {
    const sb = await userClient(otherStaff.email, otherStaff.password)
    const { data } = await sb.from('packed_pieces').select('item').eq('pack_day', DAY)
    expect((data ?? []).map(r => r.item)).toContain('BCD')

    const { error } = await sb.from('packed_pieces').delete().eq('pack_day', DAY).eq('booking_id', bookingId).eq('item', 'BCD')
    expect(error).toBeNull()
    const { data: left } = await admin.from('packed_pieces').select('item').eq('booking_id', bookingId)
    expect(left).toEqual([])
  })

  it('refuses a tick that names someone else as its packer', async () => {
    const sb = await userClient(staff.email, staff.password)
    const { error } = await sb.from('packed_pieces')
      .insert({ pack_day: DAY, booking_id: bookingId, item: 'Fins', packed_by: otherStaff.id })
    expect(error).not.toBeNull()
  })

  it('keeps a diver out entirely', async () => {
    await admin.from('packed_pieces').insert({ pack_day: DAY, booking_id: bookingId, item: 'Mask', packed_by: staff.id })
    const sb = await userClient(diver.email, diver.password)

    const { data } = await sb.from('packed_pieces').select('item').eq('pack_day', DAY)
    expect(data ?? []).toEqual([])
    const { error: insertError } = await sb.from('packed_pieces').insert({ pack_day: DAY, booking_id: bookingId, item: 'Wetsuit' })
    expect(insertError).not.toBeNull()
    await sb.from('packed_pieces').delete().eq('pack_day', DAY)
    const { data: still } = await admin.from('packed_pieces').select('item').eq('item', 'Mask')
    expect(still).toHaveLength(1)
  })

  it('keeps an anonymous visitor out entirely', async () => {
    const { data } = await anonClient().from('packed_pieces').select('item')
    expect(data ?? []).toEqual([])
    const { error } = await anonClient().from('packed_pieces').insert({ pack_day: DAY, booking_id: bookingId, item: 'Wetsuit' })
    expect(error).not.toBeNull()
  })

  // Two phones ticking the same piece at once must converge on one row, and
  // neither may fail — the app's own write path, through the app's client.
  it('takes a tick of a piece already on the list without complaint', async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: staff.email, password: staff.password })
    expect(error).toBeNull()
    await writePacked(DAY, [`${bookingId}|Regulator`], true)
    await writePacked(DAY, [`${bookingId}|Regulator`], true)
    const keys = await fetchPackedKeys(DAY)
    expect([...keys].filter(k => k.endsWith('|Regulator'))).toHaveLength(1)

    await writePacked(DAY, [`${bookingId}|Regulator`], false)
    expect(await fetchPackedKeys(DAY)).not.toContain(`${bookingId}|Regulator`)
  })

  it('goes with its booking', async () => {
    // A second person: one diver holds one active booking per event.
    const { data: b, error } = await admin.from('bookings')
      .insert({ user_id: otherStaff.id, event_id: diveId, status: 'confirmed', details: {} })
      .select('id').single()
    expect(error).toBeNull()
    await admin.from('packed_pieces').insert({ pack_day: DAY, booking_id: b!.id, item: 'BCD', packed_by: staff.id })
    await admin.from('bookings').delete().eq('id', b!.id)
    const { data } = await admin.from('packed_pieces').select('item').eq('booking_id', b!.id)
    expect(data).toEqual([])
  })
})
