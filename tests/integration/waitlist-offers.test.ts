import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient, userClient, createTestUser, createTestDive, deleteTestUser, deleteTestDive, type TestUser } from './helpers'

const admin = adminClient()
let diverA: TestUser
let diverB: TestUser
let diverC: TestUser
let fullDiveId: string
let openDiveId: string
const cancelledDives: string[] = []

beforeAll(async () => {
  diverA = await createTestUser(admin, { role: 'diver' })
  diverB = await createTestUser(admin, { role: 'diver' })
  diverC = await createTestUser(admin, { role: 'diver' })

  // Two dives — one we mark fully_booked, one we leave open. Helpers create
  // events with default fully_booked=false; flip via a follow-up update.
  fullDiveId = await createTestDive(admin)
  openDiveId = await createTestDive(admin)
  await admin.from('events' as never).update({ fully_booked: true } as never).eq('id', fullDiveId)
})

afterAll(async () => {
  if (fullDiveId) await deleteTestDive(admin, fullDiveId)
  if (openDiveId) await deleteTestDive(admin, openDiveId)
  for (const id of cancelledDives) await deleteTestDive(admin, id)
  if (diverA) await deleteTestUser(admin, diverA.id)
  if (diverB) await deleteTestUser(admin, diverB.id)
  if (diverC) await deleteTestUser(admin, diverC.id)
})

async function insertBooking(userId: string, diveId: string, statusOverride?: 'pending' | 'confirmed' | 'waitlisted') {
  const { data, error } = await admin.from('bookings').insert({
    user_id: userId,
    event_id: diveId,
    details: {},
    ...(statusOverride ? { status: statusOverride } : {}),
  } as never).select('id, status').single<{ id: string; status: string }>()
  if (error) throw error
  return data!
}

describe('set_waitlisted_when_event_full BEFORE INSERT trigger', () => {
  it("flips a default-pending insert to 'waitlisted' when the dive is fully_booked", async () => {
    const b = await insertBooking(diverA.id, fullDiveId)
    expect(b.status).toBe('waitlisted')
    await admin.from('bookings').delete().eq('id', b.id)
  })

  it("leaves status as 'pending' when the dive is NOT fully_booked", async () => {
    const b = await insertBooking(diverA.id, openDiveId)
    expect(b.status).toBe('pending')
    await admin.from('bookings').delete().eq('id', b.id)
  })

  it("does NOT override an explicitly-supplied status (admin direct-write paths still pass through)", async () => {
    const b = await insertBooking(diverA.id, fullDiveId, 'confirmed')
    expect(b.status).toBe('confirmed')
    await admin.from('bookings').delete().eq('id', b.id)
  })
})

describe('handle_booking_cancellation AFTER UPDATE trigger', () => {
  it('inserts a waitlist_offers row for the OLDEST waitlister when a confirmed booking is cancelled on a fully-booked event', async () => {
    // Set up: confirmed booking by A, two waitlisters B and C (B older).
    const aBooking = await insertBooking(diverA.id, fullDiveId, 'confirmed')
    // Force-insert waitlisted on a fully-booked event — both pass through
    // the trigger as 'waitlisted' anyway, but we make it explicit.
    const bBooking = await insertBooking(diverB.id, fullDiveId)
    // Tiny gap so B is strictly older than C by created_at.
    await new Promise(r => setTimeout(r, 50))
    const cBooking = await insertBooking(diverC.id, fullDiveId)
    expect(bBooking.status).toBe('waitlisted')
    expect(cBooking.status).toBe('waitlisted')

    // Cancel A → trigger fires, offers spot to B (older than C).
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', aBooking.id)

    const { data: offers } = await admin
      .from('waitlist_offers')
      .select('booking_id, status')
      .eq('booking_id', bBooking.id)
    expect(offers?.length).toBe(1)
    expect(offers?.[0].status).toBe('pending')

    // C should NOT have an offer yet — only the head of the queue gets one.
    const { data: cOffers } = await admin
      .from('waitlist_offers')
      .select('id')
      .eq('booking_id', cBooking.id)
    expect(cOffers?.length).toBe(0)

    // Cleanup.
    await admin.from('bookings').delete().in('id', [aBooking.id, bBooking.id, cBooking.id])
  })

  it('does NOT issue an offer when a waitlisted booking is cancelled (no real spot opened)', async () => {
    // A is waitlisted, B is also waitlisted. A cancels — that doesn't free
    // a confirmed spot, so no offer should be created for B.
    const aBooking = await insertBooking(diverA.id, fullDiveId)
    const bBooking = await insertBooking(diverB.id, fullDiveId)
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', aBooking.id)

    const { data: offers } = await admin
      .from('waitlist_offers')
      .select('id')
      .eq('booking_id', bBooking.id)
    expect(offers?.length).toBe(0)

    await admin.from('bookings').delete().in('id', [aBooking.id, bBooking.id])
  })

  it("expires any live offer on a booking when that booking gets cancelled (diver opting out while holding an offer)", async () => {
    const aBooking = await insertBooking(diverA.id, fullDiveId, 'confirmed')
    const bBooking = await insertBooking(diverB.id, fullDiveId)
    // Create the offer by cancelling A.
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', aBooking.id)

    // Now B (the offer holder) cancels their own booking.
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', bBooking.id)

    const { data: offers } = await admin
      .from('waitlist_offers')
      .select('status')
      .eq('booking_id', bBooking.id)
    expect(offers?.length).toBe(1)
    expect(offers?.[0].status).toBe('expired')

    await admin.from('bookings').delete().in('id', [aBooking.id, bBooking.id])
  })
})

describe('accept_waitlist_offer RPC', () => {
  it('atomically flips the offer to "accepted" and the booking to "pending"', async () => {
    const aBooking = await insertBooking(diverA.id, fullDiveId, 'confirmed')
    const bBooking = await insertBooking(diverB.id, fullDiveId)
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', aBooking.id)

    const { data: offer } = await admin
      .from('waitlist_offers').select('id').eq('booking_id', bBooking.id).single<{ id: string }>()

    const sb = await userClient(diverB.email, diverB.password)
    const { error } = await sb.rpc('accept_waitlist_offer', { p_offer_id: offer!.id })
    expect(error).toBeNull()

    const { data: bAfter } = await admin
      .from('bookings').select('status').eq('id', bBooking.id).single<{ status: string }>()
    expect(bAfter?.status).toBe('pending')

    const { data: oAfter } = await admin
      .from('waitlist_offers').select('status').eq('id', offer!.id).single<{ status: string }>()
    expect(oAfter?.status).toBe('accepted')

    await admin.from('bookings').delete().in('id', [aBooking.id, bBooking.id])
  })

  it("rejects a caller who doesn't own the booking (auth.uid() check)", async () => {
    const aBooking = await insertBooking(diverA.id, fullDiveId, 'confirmed')
    const bBooking = await insertBooking(diverB.id, fullDiveId)
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', aBooking.id)

    const { data: offer } = await admin
      .from('waitlist_offers').select('id').eq('booking_id', bBooking.id).single<{ id: string }>()

    // Diver C (not the offer owner) tries to accept B's offer.
    const sb = await userClient(diverC.email, diverC.password)
    const { error } = await sb.rpc('accept_waitlist_offer', { p_offer_id: offer!.id })
    expect(error).not.toBeNull()
    expect(String(error?.message)).toMatch(/forbidden|permission/i)

    // Booking + offer state must not have changed.
    const { data: bAfter } = await admin
      .from('bookings').select('status').eq('id', bBooking.id).single<{ status: string }>()
    expect(bAfter?.status).toBe('waitlisted')

    await admin.from('bookings').delete().in('id', [aBooking.id, bBooking.id])
  })

  it('rejects re-accepting an already-accepted offer (offer is no longer pending)', async () => {
    const aBooking = await insertBooking(diverA.id, fullDiveId, 'confirmed')
    const bBooking = await insertBooking(diverB.id, fullDiveId)
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', aBooking.id)
    const { data: offer } = await admin
      .from('waitlist_offers').select('id').eq('booking_id', bBooking.id).single<{ id: string }>()

    const sb = await userClient(diverB.email, diverB.password)
    await sb.rpc('accept_waitlist_offer', { p_offer_id: offer!.id })

    // Second call must fail — offer status is no longer pending.
    const { error } = await sb.rpc('accept_waitlist_offer', { p_offer_id: offer!.id })
    expect(error).not.toBeNull()

    await admin.from('bookings').delete().in('id', [aBooking.id, bBooking.id])
  })
})

describe('waitlist_offers RLS', () => {
  it('a diver only sees their own offers', async () => {
    const aBooking = await insertBooking(diverA.id, fullDiveId, 'confirmed')
    const bBooking = await insertBooking(diverB.id, fullDiveId)
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', aBooking.id)

    const sb = await userClient(diverB.email, diverB.password)
    const { data } = await sb.from('waitlist_offers').select('booking_id')
    expect((data ?? []).every(o => o.booking_id === bBooking.id)).toBe(true)

    // Diver C — different user — should see none of these.
    const sbC = await userClient(diverC.email, diverC.password)
    const { data: cView } = await sbC.from('waitlist_offers').select('booking_id').eq('booking_id', bBooking.id)
    expect(cView ?? []).toEqual([])

    await admin.from('bookings').delete().in('id', [aBooking.id, bBooking.id])
  })

  it('clients cannot directly INSERT into waitlist_offers — only the trigger / service role can', async () => {
    const bBooking = await insertBooking(diverA.id, fullDiveId)

    const sb = await userClient(diverA.email, diverA.password)
    const { error } = await sb.from('waitlist_offers').insert({
      booking_id: bBooking.id,
    } as never)

    // Either RLS error or zero rows inserted; verify nothing landed.
    const { count } = await admin
      .from('waitlist_offers')
      .select('*', { count: 'exact', head: true })
      .eq('booking_id', bBooking.id)
    expect(count).toBe(0)
    if (error) expect(String(error.message)).toMatch(/policy|permission|violat/i)

    await admin.from('bookings').delete().eq('id', bBooking.id)
  })
})

describe('a cancelled event hands out no waitlist spots', () => {
  // Divers reported "phantom pre-registrations" turning up after an event was
  // called off. Cancelling an event leaves its bookings alone by design, but
  // the waitlist machinery had no notion of a cancelled event: a diver
  // cancelling their own booking on the dead event promoted the next person on
  // the waitlist into it, and that diver ended up holding a pre-registration
  // for an event that was never going to happen.

  async function cancelledDiveWithWaitlister() {
    const dive = await createTestDive(admin)
    cancelledDives.push(dive)
    await admin.from('events' as never).update({ fully_booked: true } as never).eq('id', dive)
    const holder = await insertBooking(diverA.id, dive, 'confirmed')
    const waiter = await insertBooking(diverB.id, dive, 'waitlisted')
    await admin.from('events' as never)
      .update({ cancelled_at: new Date().toISOString() } as never).eq('id', dive)
    return { dive, holder, waiter }
  }

  function pendingOffers(bookingId: string) {
    return admin.from('waitlist_offers')
      .select('id, status').eq('booking_id', bookingId).eq('status', 'pending')
  }

  it('does not offer a spot when a booking is cancelled on a cancelled event', async () => {
    const { holder, waiter } = await cancelledDiveWithWaitlister()
    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', holder.id)

    const { data } = await pendingOffers(waiter.id)
    expect(data).toHaveLength(0)
  })

  it('expires offers that were already live when the event was cancelled', async () => {
    // Otherwise the diver is left looking at an invitation to an event that is
    // not happening.
    const dive = await createTestDive(admin)
    cancelledDives.push(dive)
    const waiter = await insertBooking(diverC.id, dive, 'waitlisted')
    const { error: offerErr } = await admin.from('waitlist_offers').insert({ booking_id: waiter.id } as never)
    expect(offerErr).toBeNull()
    expect((await pendingOffers(waiter.id)).data).toHaveLength(1)

    await admin.from('events' as never)
      .update({ cancelled_at: new Date().toISOString() } as never).eq('id', dive)

    expect((await pendingOffers(waiter.id)).data).toHaveLength(0)
  })

  it('refuses to accept an offer once the event is cancelled', async () => {
    // Belt and braces for an offer that slipped through before the guards.
    const dive = await createTestDive(admin)
    cancelledDives.push(dive)
    const waiter = await insertBooking(diverB.id, dive, 'waitlisted')
    const { data: offer } = await admin.from('waitlist_offers')
      .insert({ booking_id: waiter.id } as never).select('id').single<{ id: string }>()
    await admin.from('events' as never)
      .update({ cancelled_at: new Date().toISOString() } as never).eq('id', dive)
    // Put it back to pending so the refusal is about the event, not the status.
    await admin.from('waitlist_offers').update({ status: 'pending' } as never).eq('id', offer!.id)

    const db = await userClient(diverB.email, diverB.password)
    const { error } = await db.rpc('accept_waitlist_offer', { p_offer_id: offer!.id })
    expect(error).not.toBeNull()

    const { data: after } = await admin.from('bookings').select('status').eq('id', waiter.id).single()
    expect(after!.status).toBe('waitlisted')
  })

  it('still promotes the next waitlister on an event that is NOT cancelled', async () => {
    // The guard must not break the feature it is guarding.
    const dive = await createTestDive(admin)
    cancelledDives.push(dive)
    await admin.from('events' as never).update({ fully_booked: true } as never).eq('id', dive)
    const holder = await insertBooking(diverA.id, dive, 'confirmed')
    const waiter = await insertBooking(diverC.id, dive, 'waitlisted')

    await admin.from('bookings').update({ status: 'cancelled' } as never).eq('id', holder.id)

    const { data } = await pendingOffers(waiter.id)
    expect(data).toHaveLength(1)

    const db = await userClient(diverC.email, diverC.password)
    const { error } = await db.rpc('accept_waitlist_offer', { p_offer_id: data![0].id })
    expect(error).toBeNull()
    const { data: after } = await admin.from('bookings').select('status').eq('id', waiter.id).single()
    expect(after!.status).toBe('pending')
  })
})
