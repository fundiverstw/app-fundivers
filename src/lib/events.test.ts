/**
 * Covers the Wix special_date branches from courseToEvents (see
 * wix-site/calendar/calendar.js lines 39-75). The four branches:
 *   A) no special → one segment
 *   B) special == end → two single-day segments (start + end)
 *   C) special adjacent to start (±1d) → merged [start/special] + lone end
 *   D) special adjacent to end (±1d) → lone start + merged [end/special]
 *   E) far apart → full range + lone special
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => { from.mockReset() })

interface CourseRow {
  _id: string
  display_title: string
  start_date: string
  start_time: string | null
  end_date: string | null
  special_date: string | null
  price: string | null
  other_addons: string | null
  dive_days: number | null
  admin_title?: string | null
  calendar_title?: string | null
}

function setup(courses: CourseRow[]) {
  const builder: Record<string, unknown> = {}
  const chain = ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is', 'or']
  for (const m of chain) builder[m] = () => builder
  builder.then = (cb?: (r: unknown) => unknown) =>
    Promise.resolve({ data: courses, error: null }).then(cb)

  from.mockImplementation((table: string) => {
    if (table === 'EO_courses') return builder
    // Dives + prices empty for these tests
    const empty: Record<string, unknown> = {}
    for (const m of chain) empty[m] = () => empty
    empty.then = (cb?: (r: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(cb)
    return empty
  })
}

async function fetchAndGet(courseRow: CourseRow) {
  setup([courseRow])
  const { fetchEventsInRange } = await import('./events')
  const events = await fetchEventsInRange('2026-05-01', '2026-05-31')
  return events
}

describe('courseToEvents — Wix special_date branches', () => {
  const baseCourse: Omit<CourseRow, 'start_date' | 'end_date' | 'special_date'> = {
    _id: 'c1',
    display_title: 'AOW',
    start_time: '09:00:00',
    price: null,
    other_addons: null,
    dive_days: null,
    admin_title: null,
    calendar_title: null,
  }

  it('A: no special_date — one segment spanning start..end', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_date: '2026-05-10', end_date: '2026-05-12', special_date: null,
    })
    expect(events).toHaveLength(1)
    expect(events[0].start_time.slice(0, 10)).toBe('2026-05-10')
    expect(events[0].end_time?.slice(0, 10)).toBe('2026-05-12')
  })

  it('B: special_date == end_date — two single-day pills (start + end)', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_date: '2026-05-10', end_date: '2026-05-15', special_date: '2026-05-15',
    })
    expect(events).toHaveLength(2)
    const dates = events.map(e => [e.start_time.slice(0, 10), e.end_time?.slice(0, 10)])
    expect(dates).toContainEqual(['2026-05-10', '2026-05-10'])
    expect(dates).toContainEqual(['2026-05-15', '2026-05-15'])
  })

  it('C: special adjacent to start_date — merged [start..special] + lone end', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_date: '2026-05-10', end_date: '2026-05-20', special_date: '2026-05-11',
    })
    expect(events).toHaveLength(2)
    const dates = events.map(e => [e.start_time.slice(0, 10), e.end_time?.slice(0, 10)])
    expect(dates).toContainEqual(['2026-05-10', '2026-05-11'])
    expect(dates).toContainEqual(['2026-05-20', '2026-05-20'])
  })

  it('D: special adjacent to end_date — lone start + merged [end..special]', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_date: '2026-05-10', end_date: '2026-05-20', special_date: '2026-05-21',
    })
    expect(events).toHaveLength(2)
    const dates = events.map(e => [e.start_time.slice(0, 10), e.end_time?.slice(0, 10)])
    expect(dates).toContainEqual(['2026-05-10', '2026-05-10'])
    expect(dates).toContainEqual(['2026-05-20', '2026-05-21'])
  })

  it('E: special far from both — full [start..end] + lone [special]', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_date: '2026-05-10', end_date: '2026-05-12', special_date: '2026-05-25',
    })
    expect(events).toHaveLength(2)
    const dates = events.map(e => [e.start_time.slice(0, 10), e.end_time?.slice(0, 10)])
    expect(dates).toContainEqual(['2026-05-10', '2026-05-12'])
    expect(dates).toContainEqual(['2026-05-25', '2026-05-25'])
  })

  it('all segments share the course _id so either click books the same course', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_date: '2026-05-10', end_date: '2026-05-12', special_date: '2026-05-25',
    })
    expect(new Set(events.map(e => e.id))).toEqual(new Set(['c1']))
  })

  it('carries start_time_hhmm from the course start_time column', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_time: '14:30:00.000', start_date: '2026-05-10', end_date: '2026-05-10', special_date: null,
    })
    expect(events).toHaveLength(1)
    expect(events[0].start_time_hhmm).toBe('14:30')
  })

  it('emits start_time_hhmm = null when course has no start_time set', async () => {
    const events = await fetchAndGet({
      ...baseCourse, start_time: '', start_date: '2026-05-10', end_date: '2026-05-10', special_date: null,
    })
    expect(events).toHaveLength(1)
    expect(events[0].start_time_hhmm).toBeNull()
  })

  it('fetches courses whose special_date lands in the window even when start_date is outside it', async () => {
    // The mock builder swallows all chain calls but captures the `.or()`
    // argument so we can assert the special_date branch is part of the
    // filter — the staff-busy calendar relies on this to render the
    // special pill for a course that started before the visible month.
    const orCalls: string[] = []
    const courseRows = [{
      ...baseCourse,
      start_date: '2026-04-01',
      end_date: '2026-04-03',
      special_date: '2026-05-15',
    }]
    const courseBuilder: Record<string, unknown> = {}
    const courseChain = ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is']
    for (const m of courseChain) courseBuilder[m] = () => courseBuilder
    courseBuilder.or = (filter: string) => { orCalls.push(filter); return courseBuilder }
    courseBuilder.then = (cb?: (r: unknown) => unknown) =>
      Promise.resolve({ data: courseRows, error: null }).then(cb)

    from.mockImplementation((table: string) => {
      if (table === 'EO_courses') return courseBuilder
      const empty: Record<string, unknown> = {}
      for (const m of [...courseChain, 'or']) empty[m] = () => empty
      empty.then = (cb?: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(cb)
      return empty
    })

    const { fetchEventsInRange } = await import('./events')
    const events = await fetchEventsInRange('2026-05-01', '2026-05-31')
    expect(orCalls).toHaveLength(1)
    expect(orCalls[0]).toContain('start_date.gte.2026-05-01')
    expect(orCalls[0]).toContain('special_date.gte.2026-05-01')
    expect(orCalls[0]).toContain('special_date.lte.2026-05-31')
    // Course returned by the mock should still produce the special pill.
    const specialPill = events.find(e => e.start_time.startsWith('2026-05-15'))
    expect(specialPill).toBeDefined()
  })
})

describe('fetchEventsForBookings — full course span', () => {
  // For per-booking lookups (e.g. AdminEventDetailPage → EventStaffSection),
  // the representative event for a course must cover the full
  // [start_date..end_date] range — not a sub-segment. Otherwise the
  // staff-on-duty date picker's min/max bounds can exclude half of a
  // course whose special_date splits the calendar pills (Wix branches
  // B/C/D). This regressed when a rescue course May 30 → June 3 with a
  // gap had its duty picker stuck on May, blocking June 3 selection.
  function setupForBookings(course: CourseRow) {
    const courseBuilder: Record<string, unknown> = {}
    const chain = ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is', 'or']
    for (const m of chain) courseBuilder[m] = () => courseBuilder
    courseBuilder.then = (cb?: (r: unknown) => unknown) =>
      Promise.resolve({ data: [course], error: null }).then(cb)

    const empty: Record<string, unknown> = {}
    for (const m of chain) empty[m] = () => empty
    empty.then = (cb?: (r: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(cb)

    from.mockImplementation((table: string) => {
      if (table === 'EO_courses') return courseBuilder
      return empty
    })
  }

  it('returns one entry per course covering the full start..end range when special_date splits into two pills', async () => {
    setupForBookings({
      _id: 'c-split', display_title: 'Rescue', start_time: '09:00:00',
      start_date: '2026-05-30', end_date: '2026-06-03', special_date: '2026-05-31',
      price: null, other_addons: null, dive_days: null,
      admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings([], ['c-split'])
    expect(map.size).toBe(1)
    const ev = map.get('c-split')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-30')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-06-03')
  })

  it('preserves the start..end range when special_date == end_date', async () => {
    setupForBookings({
      _id: 'c-end-special', display_title: 'AOW', start_time: '09:00:00',
      start_date: '2026-05-30', end_date: '2026-06-03', special_date: '2026-06-03',
      price: null, other_addons: null, dive_days: null,
      admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings([], ['c-end-special'])
    const ev = map.get('c-end-special')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-30')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-06-03')
  })

  it('still works for plain single-segment courses (no special_date)', async () => {
    setupForBookings({
      _id: 'c-plain', display_title: 'OW', start_time: '09:00:00',
      start_date: '2026-05-10', end_date: '2026-05-12', special_date: null,
      price: null, other_addons: null, dive_days: null,
      admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings([], ['c-plain'])
    const ev = map.get('c-plain')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-10')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-05-12')
  })
})

describe('formatEventSpan — start_time_hhmm rendering', () => {
  it('appends · HH:mm when start_time_hhmm is set (single-day)', async () => {
    const { formatEventSpan } = await import('./events')
    const out = formatEventSpan({
      start_time: '2026-05-10T01:00:00.000Z',
      end_time: null,
      start_time_hhmm: '09:00',
    })
    expect(out).toMatch(/· 09:00$/)
  })

  it('omits time suffix when start_time_hhmm is null', async () => {
    const { formatEventSpan } = await import('./events')
    const out = formatEventSpan({
      start_time: '2026-05-10T01:00:00.000Z',
      end_time: null,
      start_time_hhmm: null,
    })
    expect(out).not.toMatch(/·/)
  })

  it('places time on the start side of a multi-day range', async () => {
    const { formatEventSpan } = await import('./events')
    const out = formatEventSpan({
      start_time: '2026-05-10T01:00:00.000Z',
      end_time: '2026-05-12T01:00:00.000Z',
      start_time_hhmm: '09:00',
    })
    expect(out).toMatch(/· 09:00 → /)
  })
})

describe('eventSpotsRemaining + eventIsFull', () => {
  it('returns null when capacity is unset (uncapped event)', async () => {
    const { eventSpotsRemaining, eventIsFull } = await import('./events')
    expect(eventSpotsRemaining({ capacity: null, confirmed_count: 0 })).toBeNull()
    expect(eventIsFull({ fully_booked: false, capacity: null, confirmed_count: 99 })).toBe(false)
  })

  it('returns null when confirmed_count has not been loaded', async () => {
    const { eventSpotsRemaining } = await import('./events')
    expect(eventSpotsRemaining({ capacity: 10, confirmed_count: null })).toBeNull()
  })

  it('computes remaining = capacity - confirmed_count', async () => {
    const { eventSpotsRemaining, eventIsFull } = await import('./events')
    expect(eventSpotsRemaining({ capacity: 10, confirmed_count: 7 })).toBe(3)
    expect(eventIsFull({ fully_booked: false, capacity: 10, confirmed_count: 7 })).toBe(false)
  })

  it('clamps remaining at 0 when confirmed exceeds capacity', async () => {
    const { eventSpotsRemaining, eventIsFull } = await import('./events')
    expect(eventSpotsRemaining({ capacity: 5, confirmed_count: 7 })).toBe(0)
    expect(eventIsFull({ fully_booked: false, capacity: 5, confirmed_count: 7 })).toBe(true)
  })

  it('eventIsFull respects manual fully_booked flag even without capacity', async () => {
    const { eventIsFull } = await import('./events')
    expect(eventIsFull({ fully_booked: true, capacity: null, confirmed_count: 0 })).toBe(true)
    expect(eventIsFull({ fully_booked: true, capacity: 10, confirmed_count: 0 })).toBe(true)
  })
})
