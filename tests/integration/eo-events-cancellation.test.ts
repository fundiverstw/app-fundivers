import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient } from './helpers'
import { fetchEventsInRange, fetchEventsForBookings } from '../../src/lib/events'

// Pins the soft-cancellation contract on the unified events table:
//   - cancelled_at is null  → event surfaces in calendar / listing reads
//   - cancelled_at is set   → event vanishes from calendar / listing reads
//                              but stays queryable by id (so existing
//                              bookings can still resolve their event info).

const admin = adminClient()
const createdEventIds: string[] = []

beforeAll(() => {
  // The events helpers read via the module-level `supabase` client (anon
  // key); seeding goes through the service-role admin client to bypass RLS.
})

afterAll(async () => {
  for (const id of createdEventIds) await admin.from('events' as never).delete().eq('id', id)
})

describe('cancelled events are filtered from listing reads', () => {
  it('hides a cancelled dive from fetchEventsInRange but keeps it in fetchEventsForBookings', async () => {
    const id = crypto.randomUUID()
    createdEventIds.push(id)
    const start = '2027-09-15'
    await admin.from('events' as never).insert({
      id,
      kind: 'dive',
      admin_title: 'Cancellation test dive',
      notes: '',
      start_date: start,
      start_time: '09:00:00',
      end_date: start,
    } as never)

    // Visible while active.
    const before = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(before.some(e => e.id === id)).toBe(true)

    // Mark cancelled.
    await admin.from('events' as never).update({ cancelled_at: new Date().toISOString() } as never).eq('id', id)

    // Vanishes from listing reads.
    const after = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(after.some(e => e.id === id)).toBe(false)

    // Still resolvable by id for the bookings page.
    const lookup = await fetchEventsForBookings([id])
    expect(lookup.has(id)).toBe(true)
    expect(lookup.get(id)?.cancelled_at).not.toBeNull()
  })

  it('hides a cancelled course from fetchEventsInRange', async () => {
    const id = crypto.randomUUID()
    createdEventIds.push(id)
    const start = '2027-09-15'
    await admin.from('events' as never).insert({
      id,
      kind: 'course',
      display_title: 'Cancellation test course',
      start_time: '09:00:00',
      course_days: [start],
    } as never)

    const before = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(before.some(e => e.id === id)).toBe(true)

    await admin.from('events' as never).update({ cancelled_at: new Date().toISOString() } as never).eq('id', id)

    const after = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(after.some(e => e.id === id)).toBe(false)
  })
})
