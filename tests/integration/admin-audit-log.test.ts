import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
// Each test uses a fresh dive to avoid the (user_id, event_id) uniqueness
// trouble that shows up once you try to insert multiple bookings for the
// same diver × dive combination.
const diveIds: string[] = []

async function freshDive(): Promise<string> {
  const id = await createTestDive(admin)
  diveIds.push(id)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
})

afterAll(async () => {
  for (const id of diveIds) await deleteTestDive(admin, id)
  if (adminUser) await deleteTestUser(admin, adminUser.id)
  if (diver)     await deleteTestUser(admin, diver.id)
})

describe('admin_audit_log', () => {
  // Settling a cancellation is the one money decision that records no payment
  // and no credit — the whole point is that nothing moves. So the audit log is
  // the ONLY trace of it, and it has to carry enough to reconstruct who kept
  // how much, and when.
  it('logs an admin settling a cancelled booking, with before and after', async () => {
    const dive = await freshDive()
    const { data: inserted } = await admin.from('bookings').insert({
      user_id: diver.id, event_id: dive, status: 'cancelled', details: { total: 3000 },
    }).select().single()
    const bookingId = inserted!.id

    const adminSb = await userClient(adminUser.email, adminUser.password)
    const settledAt = new Date().toISOString()
    const { error } = await adminSb.from('bookings').update({
      cancellation_settled_at:   settledAt,
      cancellation_settled_by:   adminUser.id,
      cancellation_settled_note: 'Shop kept TWD 500 as a cancellation fee',
    } as never).eq('id', bookingId)
    expect(error).toBeNull()

    const { data: audit } = await admin
      .from('admin_audit_log')
      .select('*')
      .eq('target_table', 'bookings')
      .eq('target_id', bookingId)
      .eq('action', 'update')
      .order('created_at', { ascending: false })
      .limit(1)
    expect(audit).toHaveLength(1)

    const row = audit![0] as {
      actor_id: string
      before: Record<string, unknown>
      after: Record<string, unknown>
    }
    // Who did it, what it looked like before, and what was kept.
    expect(row.actor_id).toBe(adminUser.id)
    expect(row.before.cancellation_settled_at).toBeNull()
    // Postgres renders the offset as +00:00 where JS renders Z — compare the
    // instant, not the spelling.
    expect(new Date(row.after.cancellation_settled_at as string).getTime())
      .toBe(new Date(settledAt).getTime())
    expect(row.after.cancellation_settled_by).toBe(adminUser.id)
    expect(row.after.cancellation_settled_note).toMatch(/cancellation fee/i)
  })

  it('logs a booking status change performed by an admin', async () => {
    // Set up a booking owned by the diver.
    const dive = await freshDive()
    const { data: inserted } = await admin.from('bookings').insert({
      user_id: diver.id, event_id: dive, status: 'pending', details: {},
    }).select().single()
    const bookingId = inserted!.id

    // Admin updates status → should generate an audit row.
    const adminSb = await userClient(adminUser.email, adminUser.password)
    await adminSb.from('bookings').update({ status: 'confirmed' }).eq('id', bookingId)

    const { data: audit } = await admin
      .from('admin_audit_log')
      .select('*')
      .eq('target_table', 'bookings')
      .eq('target_id', bookingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    expect(audit).not.toBeNull()
    expect(audit!.actor_id).toBe(adminUser.id)
    expect(audit!.action).toBe('update')
    expect((audit!.before as { status: string }).status).toBe('pending')
    expect((audit!.after  as { status: string }).status).toBe('confirmed')
  })

  it('does NOT log when a diver updates their own booking', async () => {
    const dive = await freshDive()
    const { data: inserted } = await admin.from('bookings').insert({
      user_id: diver.id, event_id: dive, status: 'pending', details: {},
    }).select().single()
    const bookingId = inserted!.id

    const diverSb = await userClient(diver.email, diver.password)
    await diverSb.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId)

    const { data: audit } = await admin
      .from('admin_audit_log')
      .select('id')
      .eq('target_table', 'bookings')
      .eq('target_id', bookingId)
    expect(audit ?? []).toEqual([])
  })

  it('does NOT log service-role (migrations, workers) writes', async () => {
    const dive = await freshDive()
    const { data: inserted } = await admin.from('bookings').insert({
      user_id: diver.id, event_id: dive, status: 'pending', details: {},
    }).select().single()
    const { data: audit } = await admin
      .from('admin_audit_log')
      .select('id')
      .eq('target_table', 'bookings')
      .eq('target_id', inserted!.id)
    expect(audit ?? []).toEqual([])
  })

  // The tables that move money were the ones nobody was watching. Asked why
  // three divers held refund credit against bookings whose payments had been
  // voided, the database had nothing to say -- not who, not when, not from
  // what state.
  it('logs a payment being voided, with the state it was voided from', async () => {
    const dive = await freshDive()
    const { data: booking } = await admin.from('bookings').insert({
      user_id: diver.id, event_id: dive, status: 'confirmed', details: { total: 3000 },
    }).select('id').single()
    const { data: payment } = await admin.from('payments').insert({
      user_id: diver.id, booking_id: booking!.id, amount: 3000, status: 'paid',
      method: 'bank_transfer', note: 'test', reference: 'R-1',
    }).select('id').single()

    const adminSb = await userClient(adminUser.email, adminUser.password)
    const { error } = await adminSb.from('payments')
      .update({ status: 'voided' }).eq('id', payment!.id)
    expect(error).toBeNull()

    const { data: log } = await admin.from('admin_audit_log')
      .select('*').eq('target_table', 'payments').eq('target_id', payment!.id)
      .order('created_at', { ascending: false }).limit(1).single()
    expect(log!.actor_id).toBe(adminUser.id)
    expect(log!.action).toBe('update')
    expect((log!.before as { status: string }).status).toBe('paid')
    expect((log!.after as { status: string }).status).toBe('voided')
  })

  it('logs an admin issuing a credit', async () => {
    const adminSb = await userClient(adminUser.email, adminUser.password)
    const { data: credit, error } = await adminSb.from('credits').insert({
      user_id: diver.id, amount: 500, currency: 'TWD',
      reason: 'goodwill', status: 'open', source: 'manual', created_by: adminUser.id,
    }).select('id').single()
    expect(error).toBeNull()

    const { data: log } = await admin.from('admin_audit_log')
      .select('*').eq('target_table', 'credits').eq('target_id', credit!.id).single()
    expect(log!.actor_id).toBe(adminUser.id)
    expect(log!.action).toBe('insert')
    expect(Number((log!.after as { amount: string }).amount)).toBe(500)

    await admin.from('credits').delete().eq('id', credit!.id)
  })

  it('diver cannot read the audit log (RLS)', async () => {
    const diverSb = await userClient(diver.email, diver.password)
    const { data } = await diverSb.from('admin_audit_log').select('id').limit(1)
    expect(data ?? []).toEqual([])
  })

  it('logs a profile status change performed by an admin (audit H6)', async () => {
    // notify-application-decision flips profiles.status to active /
    // rejected. It must go through the caller's authed client so the
    // audit trigger sees auth.uid() and records the row. This test
    // mimics what the edge function now does end-to-end.
    const target = await createTestUser(admin, { role: 'diver', status: 'pending' })
    try {
      const adminSb = await userClient(adminUser.email, adminUser.password)
      const { error } = await adminSb.from('profiles')
        .update({ status: 'active' }).eq('id', target.id)
      expect(error).toBeNull()

      const { data: audit } = await admin
        .from('admin_audit_log')
        .select('actor_id,action,before,after')
        .eq('target_table', 'profiles')
        .eq('target_id', target.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      expect(audit).not.toBeNull()
      expect(audit!.actor_id).toBe(adminUser.id)
      expect(audit!.action).toBe('update')
      expect((audit!.before as { status: string }).status).toBe('pending')
      expect((audit!.after  as { status: string }).status).toBe('active')
    } finally {
      await deleteTestUser(admin, target.id)
    }
  })
})
