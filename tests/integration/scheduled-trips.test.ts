// Integration tests for Scheduled Trips (20260707160000_scheduled_trips.sql).
// What we lock in against the live stack:
//   1. The base table is admin-only — a diver reads nothing from scheduled_trips
//      directly, and a non-admin cannot insert.
//   2. list_scheduled_trips() returns only PUBLISHED rows and carries the linked
//      event's kind (null when unlinked) so the client can build a register link.
//   3. Deleting a linked event sets scheduled_trips.event_id to null (the trip
//      survives as an informational listing).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  adminClient, userClient,
  createTestUser, deleteTestUser, createTestDive, deleteTestDive,
  type TestUser,
} from './helpers'

const admin = adminClient()
let adminUser: TestUser
let diver: TestUser
const cleanupUsers: string[] = []
const cleanupTrips: string[] = []
const cleanupEvents: string[] = []

async function createTrip(args: {
  status?: 'draft' | 'published' | 'archived'
  eventId?: string | null
  overrides?: Record<string, unknown>
}): Promise<string> {
  const { data, error } = await admin.from('scheduled_trips').insert({
    title: 'Green Island Weekend',
    destination: 'Green Island',
    status: args.status ?? 'published',
    event_id: args.eventId ?? null,
    published_at: args.status === 'published' || args.status === undefined ? new Date().toISOString() : null,
    ...args.overrides,
  } as never).select('id').single()
  if (error) throw new Error(`createTrip failed: ${error.message}`)
  const id = (data as { id: string }).id
  cleanupTrips.push(id)
  return id
}

beforeAll(async () => {
  adminUser = await createTestUser(admin, { role: 'admin' })
  diver     = await createTestUser(admin, { role: 'diver' })
  cleanupUsers.push(adminUser.id, diver.id)
})

afterAll(async () => {
  for (const id of cleanupTrips) await admin.from('scheduled_trips').delete().eq('id', id)
  for (const id of cleanupEvents) await deleteTestDive(admin, id)
  for (const id of cleanupUsers) await deleteTestUser(admin, id)
})

describe('base table is admin-only', () => {
  it('a diver reads nothing from scheduled_trips directly', async () => {
    await createTrip({ status: 'published' })
    const asDiver = await userClient(diver.email, diver.password)
    const { data, error } = await asDiver.from('scheduled_trips').select('*')
    expect(error).toBeNull()          // RLS filters rows, it doesn't error
    expect(data ?? []).toHaveLength(0)
  })

  it('a non-admin cannot insert a scheduled trip', async () => {
    const asDiver = await userClient(diver.email, diver.password)
    const { error } = await asDiver.from('scheduled_trips')
      .insert({ title: 'Rogue', destination: 'X' } as never)
    expect(error).not.toBeNull()
  })
})

describe('list_scheduled_trips()', () => {
  it('shows only published trips and carries the linked event kind', async () => {
    const eventId = await createTestDive(admin)
    cleanupEvents.push(eventId)
    const published = await createTrip({ status: 'published', eventId, overrides: { title: 'Published Trip' } })
    await createTrip({ status: 'draft', overrides: { title: 'Draft Trip' } })
    await createTrip({ status: 'archived', overrides: { title: 'Archived Trip' } })

    const asDiver = await userClient(diver.email, diver.password)
    const { data: list, error } = await asDiver.rpc('list_scheduled_trips')
    expect(error).toBeNull()

    const match = (list ?? []).filter(r => (r as { id: string }).id === published)
    expect(match).toHaveLength(1)
    const row = match[0] as Record<string, unknown>
    expect(row.title).toBe('Published Trip')
    expect(row.event_id).toBe(eventId)
    expect(row.event_kind).toBe('dive')

    const titles = (list ?? []).map(r => (r as { title: string }).title)
    expect(titles).not.toContain('Draft Trip')
    expect(titles).not.toContain('Archived Trip')
  })

  it('returns a null event_kind for an unlinked trip', async () => {
    const id = await createTrip({ status: 'published', eventId: null, overrides: { title: 'Unlinked Trip' } })
    const asDiver = await userClient(diver.email, diver.password)
    const { data: list } = await asDiver.rpc('list_scheduled_trips')
    const row = (list ?? []).find(r => (r as { id: string }).id === id) as Record<string, unknown>
    expect(row.event_id).toBeNull()
    expect(row.event_kind).toBeNull()
  })
})

describe('event link lifecycle', () => {
  it('nulls event_id when the linked event is deleted, keeping the trip', async () => {
    const eventId = await createTestDive(admin)
    const tripId = await createTrip({ status: 'published', eventId })

    await deleteTestDive(admin, eventId)

    const { data } = await admin.from('scheduled_trips').select('id, event_id').eq('id', tripId).single()
    expect((data as { id: string }).id).toBe(tripId)
    expect((data as { event_id: string | null }).event_id).toBeNull()
  })
})
