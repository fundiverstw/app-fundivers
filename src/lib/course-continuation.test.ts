import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  attendsOnDay, attendDayKeys, bookingsOnDay, isCourseContinuation,
  fetchContinuableCourses, createCourseContinuation,
} from './course-continuation'
import type { Booking } from '../types/database'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

function booking(over: Partial<Booking>): Booking {
  return {
    id: 'b1', created_at: '2026-06-01T00:00:00Z', user_id: 'u1', event_id: 'e1',
    status: 'confirmed', notes: null, details: {}, refund_requested_at: null,
    group_id: null, payer_id: null, continues_booking_id: null, attend_days: null,
    ...over,
  } as Booking
}

function queryStub(result: unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'in']) b[m] = () => b
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res)
  return b
}

beforeEach(() => { from.mockReset(); rpc.mockReset() })

describe('attend days', () => {
  // NULL attend_days is what every booking made before this feature carries,
  // and what a diver attending the whole course carries. It cannot be read as
  // "attends nothing" without emptying every roster in the shop.
  it('treats a booking with no day limit as present on any day', () => {
    expect(attendsOnDay(booking({}), '2026-07-04')).toBe(true)
    expect(attendDayKeys(booking({}))).toEqual([])
  })

  it('limits a booking to the days it names', () => {
    const b = booking({ attend_days: ['2026-07-03', '2026-07-04'] })
    expect(attendsOnDay(b, '2026-07-03')).toBe(true)
    expect(attendsOnDay(b, '2026-07-05')).toBe(false)
  })

  it('accepts a timestamp-shaped day value', () => {
    const b = booking({ attend_days: ['2026-07-03T00:00:00+08:00'] })
    expect(attendsOnDay(b, '2026-07-03')).toBe(true)
  })

  it('filters a day roster down to who is actually there', () => {
    const all = [
      booking({ id: 'full' }),
      booking({ id: 'firstHalf', attend_days: ['2026-07-01', '2026-07-02'] }),
      booking({ id: 'secondHalf', attend_days: ['2026-07-03', '2026-07-04'] }),
    ]
    expect(bookingsOnDay(all, '2026-07-01').map(b => b.id)).toEqual(['full', 'firstHalf'])
    expect(bookingsOnDay(all, '2026-07-04').map(b => b.id)).toEqual(['full', 'secondHalf'])
  })

  it('recognises a continuation booking', () => {
    expect(isCourseContinuation(booking({ continues_booking_id: 'b0' }))).toBe(true)
    expect(isCourseContinuation(booking({}))).toBe(false)
  })
})

describe('fetchContinuableCourses', () => {
  const events = [
    { id: 'course-a', kind: 'course', display_title: 'OW June', admin_title: null, course_days: ['2026-06-06', '2026-06-07'] },
    { id: 'course-b', kind: 'course', display_title: 'OW July', admin_title: null, course_days: ['2026-07-04', '2026-07-05'] },
    { id: 'dive-x',   kind: 'dive',   display_title: 'Fun dive', admin_title: null, course_days: null },
  ]

  function stubTables(bookings: Booking[]) {
    from.mockImplementation((table: string) =>
      queryStub(table === 'bookings' ? { data: bookings, error: null } : { data: events, error: null }))
  }

  it('offers only course bookings, newest course first', async () => {
    stubTables([
      booking({ id: 'b-a', event_id: 'course-a' }),
      booking({ id: 'b-b', event_id: 'course-b' }),
      booking({ id: 'b-x', event_id: 'dive-x' }),
    ])
    const rows = await fetchContinuableCourses('u1', 'course-target')
    expect(rows.map(r => r.booking.id)).toEqual(['b-b', 'b-a'])
    expect(rows[0].courseDays).toEqual(['2026-07-04', '2026-07-05'])
  })

  it('never offers the course being continued onto', async () => {
    stubTables([booking({ id: 'b-a', event_id: 'course-a' })])
    expect(await fetchContinuableCourses('u1', 'course-a')).toEqual([])
  })

  // A third leg must point at the booking holding the money, not at the second
  // leg — the RPC refuses the chain, so the picker must not offer it.
  it('never offers a booking that is itself a continuation', async () => {
    stubTables([booking({ id: 'b-a', event_id: 'course-a', continues_booking_id: 'b-0' })])
    expect(await fetchContinuableCourses('u1', 'course-target')).toEqual([])
  })

  it('throws when the read fails rather than showing an empty picker', async () => {
    from.mockImplementation(() => queryStub({ data: null, error: { message: 'nope' } }))
    await expect(fetchContinuableCourses('u1', 'e')).rejects.toThrow('nope')
  })
})

describe('createCourseContinuation', () => {
  it('sends the pairing and the chosen days', async () => {
    rpc.mockResolvedValue({ data: 'new-booking', error: null })
    const id = await createCourseContinuation({
      sourceBookingId: 'b0', eventId: 'e2', days: ['2026-07-04'],
    })
    expect(id).toBe('new-booking')
    const [fn, args] = rpc.mock.calls[0]
    expect(fn).toBe('create_course_continuation')
    expect(args).toMatchObject({ p_source_booking: 'b0', p_event_id: 'e2', p_days: ['2026-07-04'] })
    // No trim asked for → the original booking keeps its "all days" NULL.
    expect(args).not.toHaveProperty('p_source_days')
  })

  it('passes the original-course trim when one is given', async () => {
    rpc.mockResolvedValue({ data: 'new-booking', error: null })
    await createCourseContinuation({
      sourceBookingId: 'b0', eventId: 'e2', days: ['2026-07-04'], sourceDays: ['2026-06-06'],
    })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_source_days: ['2026-06-06'] })
  })

  it('surfaces the database rule that refused it', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'this diver is already booked on that course' } })
    await expect(createCourseContinuation({ sourceBookingId: 'b0', eventId: 'e2', days: ['2026-07-04'] }))
      .rejects.toThrow(/already booked/)
  })
})
