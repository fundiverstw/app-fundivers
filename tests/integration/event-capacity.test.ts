import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, createTestUser, createTestDive, deleteTestUser, deleteTestDive, type TestUser } from './helpers'

// Verifies the capacity branch of set_waitlisted_when_event_full and the
// event_confirmed_counts RPC. Confirmed bookings count toward capacity;
// pending bookings don't. When capacity is exhausted by confirmed bookings,
// new pending inserts flip to waitlisted.

const admin = adminClient()
let diverA: TestUser
let diverB: TestUser
let diverC: TestUser
let diveId: string

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
  diverC = await createTestUser(admin, { role: 'diver' })
  diveId = await createTestDive(admin)
  await admin.from('EO_dives').update({ capacity: 2 } as never).eq('_id', diveId)
})

afterAll(async () => {
  if (diveId) await deleteTestDive(admin, diveId)
  if (diverA) await deleteTestUser(admin, diverA.id)
  if (diverB) await deleteTestUser(admin, diverB.id)
  if (diverC) await deleteTestUser(admin, diverC.id)
})

async function insertBooking(userId: string, statusOverride?: 'pending' | 'confirmed' | 'waitlisted') {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId,
    eo_dive_id: diveId,
    eo_course_id: null,
    details: {},
    ...(statusOverride ? { status: statusOverride } : {}),
  } as never).select('id, status').single<{ id: string; status: string }>()
  if (error) throw error
  return data!
}

describe('event capacity + waitlist trigger', () => {
  it('flips pending → waitlisted once confirmed bookings reach capacity', async () => {
    // Capacity = 2, so two confirmed bookings should fill it. Direct-insert
    // 'confirmed' to bypass the gate; this mirrors the admin add-diver flow.
    const a = await insertBooking(diverA.id, 'confirmed')
    const b = await insertBooking(diverB.id, 'confirmed')
    expect(a.status).toBe('confirmed')
    expect(b.status).toBe('confirmed')

    // Third booking (default pending) hits the trigger → waitlisted.
    const c = await insertBooking(diverC.id)
    expect(c.status).toBe('waitlisted')

    // Cleanup
    await admin.from('bookings').delete().in('id', [a.id, b.id, c.id])
  })

  it("pending bookings do NOT consume a spot — three pendings stay pending under capacity=2", async () => {
    const a = await insertBooking(diverA.id) // pending
    const b = await insertBooking(diverB.id) // pending
    const c = await insertBooking(diverC.id) // pending
    expect(a.status).toBe('pending')
    expect(b.status).toBe('pending')
    expect(c.status).toBe('pending')
    await admin.from('bookings').delete().in('id', [a.id, b.id, c.id])
  })

  it('event_confirmed_counts returns the right aggregate for capped events', async () => {
    const a = await insertBooking(diverA.id, 'confirmed')
    const b = await insertBooking(diverB.id, 'confirmed')

    const { data, error } = await admin.rpc('event_confirmed_counts' as never, {
      p_dive_ids:   [diveId],
      p_course_ids: [],
    } as never)
    expect(error).toBeNull()
    const rows = (data ?? []) as Array<{ event_id: string; event_type: string; n: number }>
    const row = rows.find(r => r.event_id === diveId)
    expect(row?.n).toBe(2)

    await admin.from('bookings').delete().in('id', [a.id, b.id])
  })
})
