// Integration tests for Scheduled Trips (20260708210000_scheduled_trip_registration.sql).
// What we lock in against the live stack:
//   1. Base tables are admin-only — a diver reads nothing from scheduled_trips /
//      scheduled_trip_registrations directly, and a non-admin cannot insert.
//   2. list_scheduled_trips() returns only PUBLISHED rows and carries the catalog
//      add-on/room ids (no event columns anymore).
//   3. list_my_scheduled_trip_registrations() is caller-scoped; the one-live index
//      blocks a duplicate live registration; a diver cancels their own via the RPC.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
let otherDiver: TestUser
const cleanupUsers: string[] = []
const cleanupTrips: string[] = []

async function createTrip(args: {
  status?: 'draft' | 'published' | 'archived'
  overrides?: Record<string, unknown>
} = {}): Promise<string> {
  const { data, error } = await admin.from('scheduled_trips').insert({
    title: 'Green Island Weekend',
    destination: 'Green Island',
    status: args.status ?? 'published',
    price: 12000,
    currency: 'TWD',
    start_date: '2026-09-01',
    end_date: '2026-09-03',
    published_at: args.status === 'published' || args.status === undefined ? new Date().toISOString() : null,
    ...args.overrides,
  } as never).select('id').single()
  if (error) throw new Error(`createTrip failed: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupTrips.push(id)
  return id
}

/** Insert a registration the way the register-scheduled-trip edge function does. */
async function createRegistration(tripId: string, diverId: string, estimatedCost = 12000) {
  return admin.from('scheduled_trip_registrations').insert({
    scheduled_trip_id: tripId,
    diver_id: diverId,
    estimated_cost: estimatedCost,
    estimated_currency: 'TWD',
  } as never).select('id').single()
}

beforeAll(async () => {
  adminUser  = await createTestUser(admin, { role: 'admin' })
  diver      = await createTestUser(admin, { role: 'diver' })
  otherDiver = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, diver.id, otherDiver.id)
})

afterAll(async () => {
  for (const id of cleanupTrips) await admin.from('scheduled_trips').delete().eq('id', id)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('base tables are admin-only', () => {
  it('a diver reads nothing from scheduled_trips / scheduled_trip_registrations directly', async () => {
    const trip = await createTrip({ status: 'published' })
    await createRegistration(trip, diver.id)
    const asDiver = await userClient(diver.email, diver.password)

    for (const table of ['scheduled_trips', 'scheduled_trip_registrations'] as const) {
      const { data, error } = await asDiver.from(table).select('*')
      expect(error).toBeNull()          // RLS filters rows, it doesn't error
      expect(data ?? []).toHaveLength(0)
    }
  })

  it('a non-admin cannot insert a scheduled trip', async () => {
    const asDiver = await userClient(diver.email, diver.password)
    const { error } = await asDiver.from('scheduled_trips')
      .insert({ title: 'Rogue', destination: 'X' } as never)
    expect(error).not.toBeNull()
  })
})

describe('list_scheduled_trips()', () => {
  it('shows only published trips and carries the catalog ids', async () => {
    const published = await createTrip({ status: 'published', overrides: { title: 'Published Trip' } })
    await createTrip({ status: 'draft', overrides: { title: 'Draft Trip' } })

    const asDiver = await userClient(diver.email, diver.password)
    const { data: list, error } = await asDiver.rpc('list_scheduled_trips')
    expect(error).toBeNull()

    const row = (list ?? []).find(r => (r as { id: string }).id === published) as Record<string, unknown>
    expect(row.title).toBe('Published Trip')
    expect(Array.isArray(row.addon_ids)).toBe(true)
    expect(Array.isArray(row.room_type_ids)).toBe(true)
    expect('event_id' in row).toBe(false)

    const titles = (list ?? []).map(r => (r as { title: string }).title)
    expect(titles).not.toContain('Draft Trip')
  })
})

describe('list_my_scheduled_trip_registrations()', () => {
  it('scopes to the caller with trip labels + estimate', async () => {
    const trip = await createTrip({ status: 'published' })
    await createRegistration(trip, diver.id, 15400)
    await createRegistration(trip, otherDiver.id)

    const asDiver = await userClient(diver.email, diver.password)
    const { data: mineAll, error } = await asDiver.rpc('list_my_scheduled_trip_registrations')
    expect(error).toBeNull()
    const mine = (mineAll ?? []).filter(r => (r as { scheduled_trip_id: string }).scheduled_trip_id === trip)
    expect(mine).toHaveLength(1)
    const row = mine[0] as Record<string, unknown>
    expect(row.trip_title).toBe('Green Island Weekend')
    expect(Number(row.estimated_cost)).toBe(15400)
  })
})

describe('cancel_my_scheduled_trip_registration()', () => {
  it('cancels the caller’s own row and frees the one-live index', async () => {
    const trip = await createTrip({ status: 'published' })
    const ins = await createRegistration(trip, diver.id)
    const id = (ins.data as { id: string }).id

    const dup = await createRegistration(trip, diver.id)
    expect(dup.error).not.toBeNull()

    const asDiver = await userClient(diver.email, diver.password)
    const { error } = await asDiver.rpc('cancel_my_scheduled_trip_registration', { p_id: id })
    expect(error).toBeNull()

    const { data: after } = await admin.from('scheduled_trip_registrations').select('status').eq('id', id).single()
    expect((after as { status: string }).status).toBe('cancelled')

    const retry = await createRegistration(trip, diver.id)
    expect(retry.error).toBeNull()
  })

  it('cannot cancel another diver’s registration', async () => {
    const trip = await createTrip({ status: 'published' })
    const ins = await createRegistration(trip, otherDiver.id)
    const id = (ins.data as { id: string }).id

    const asDiver = await userClient(diver.email, diver.password)
    await asDiver.rpc('cancel_my_scheduled_trip_registration', { p_id: id })
    const { data: after } = await admin.from('scheduled_trip_registrations').select('status').eq('id', id).single()
    expect((after as { status: string }).status).toBe('registered')
  })
})
