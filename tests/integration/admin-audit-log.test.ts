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
// Each test uses a fresh dive to avoid the (user_id, eo_dive_id) uniqueness
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
  it('logs a booking status change performed by an admin', async () => {
    // Set up a booking owned by the diver.
    const dive = await freshDive()
    const { data: inserted } = await admin.from('bookings').insert({
      user_id: diver.id, eo_dive_id: dive, status: 'pending', details: {},
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
      user_id: diver.id, eo_dive_id: dive, status: 'pending', details: {},
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
      user_id: diver.id, eo_dive_id: dive, status: 'pending', details: {},
    }).select().single()
    const { data: audit } = await admin
      .from('admin_audit_log')
      .select('id')
      .eq('target_table', 'bookings')
      .eq('target_id', inserted!.id)
    expect(audit ?? []).toEqual([])
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
