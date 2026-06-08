import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { adminClient } from './helpers'
import { fetchEventsInRange, fetchEventsForBookings } from '../../src/lib/events'

// Pins the soft-cancellation contract on EO_dives / EO_courses:
//   - cancelled_at is null  → event surfaces in calendar / listing reads
//   - cancelled_at is set   → event vanishes from calendar / listing reads
//                              but stays queryable by id (so existing
//                              bookings can still resolve their event info).

const admin = adminClient()
const createdDiveIds: string[] = []
const createdCourseIds: string[] = []

beforeAll(() => {
  // The events helpers read via the module-level `supabase` client (anon
  // key); seeding goes through the service-role admin client to bypass RLS.
})

afterAll(async () => {
  for (const id of createdDiveIds)   await admin.from('EO_dives'   as never).delete().eq('_id', id)
  for (const id of createdCourseIds) await admin.from('EO_courses' as never).delete().eq('_id', id)
})

describe('cancelled events are filtered from listing reads', () => {
  it('hides a cancelled dive from fetchEventsInRange but keeps it in fetchEventsForBookings', async () => {
    const id = crypto.randomUUID()
    createdDiveIds.push(id)
    const start = '2027-09-15'
    await admin.from('EO_dives' as never).insert({
      _id: id,
      admin_title: 'Cancellation test dive',
      notes: '',
      start_date: start,
      end_date: start,
    } as never)

    // Visible while active.
    const before = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(before.some(e => e.id === id)).toBe(true)

    // Mark cancelled.
    await admin.from('EO_dives' as never).update({ cancelled_at: new Date().toISOString() } as never).eq('_id', id)

    // Vanishes from listing reads.
    const after = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(after.some(e => e.id === id)).toBe(false)

    // Still resolvable by id for the bookings page.
    const lookup = await fetchEventsForBookings([id], [])
    expect(lookup.has(id)).toBe(true)
    expect(lookup.get(id)?.cancelled_at).not.toBeNull()
  })

  it('hides a cancelled course from fetchEventsInRange', async () => {
    const id = crypto.randomUUID()
    createdCourseIds.push(id)
    const start = '2027-09-15'
    await admin.from('EO_courses' as never).insert({
      _id: id,
      display_title: 'Cancellation test course',
      course_days: [start],
    } as never)

    const before = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(before.some(e => e.id === id)).toBe(true)

    await admin.from('EO_courses' as never).update({ cancelled_at: new Date().toISOString() } as never).eq('_id', id)

    const after = await fetchEventsInRange('2027-09-01', '2027-09-30')
    expect(after.some(e => e.id === id)).toBe(false)
  })
})
