/**
 * Covers courseToEvents — a course runs on an explicit list of days
 * (course_days, max 4). Adjacent days group into one continuous segment;
 * gaps emit separate segments. The range fetch matches courses by
 * overlapping course_days against every date in the window (there is no
 * start_date/end_date envelope on EO_courses anymore).
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
  start_time: string | null
  course_days: string[] | null
  price: string | null
  other_addons: string | null
  dive_days: number | null
  admin_title?: string | null
  calendar_title?: string | null
  included?: string | null
  schedule?: string | null
  prereqs?: string | null
  req_dives?: string | null
}

function setup(courses: CourseRow[]) {
  const builder: Record<string, unknown> = {}
  const chain = ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is', 'or', 'overlaps']
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

describe('courseToEvents — course_days run grouping', () => {
  const baseCourse: Omit<CourseRow, 'course_days'> = {
    _id: 'c1',
    display_title: 'AOW',
    start_time: '09:00:00',
    price: null,
    other_addons: null,
    dive_days: null,
    admin_title: null,
    calendar_title: null,
  }

  // Convenience: build a row from its day list.
  function course(days: string[], extra: Partial<CourseRow> = {}): CourseRow {
    return {
      ...baseCourse,
      course_days: days,
      ...extra,
    }
  }

  it('single day — one single-day segment', async () => {
    const events = await fetchAndGet(course(['2026-05-10']))
    expect(events).toHaveLength(1)
    expect(events[0].start_time.slice(0, 10)).toBe('2026-05-10')
    expect(events[0].end_time?.slice(0, 10)).toBe('2026-05-10')
  })

  it('two adjacent days — one continuous segment', async () => {
    const events = await fetchAndGet(course(['2026-05-10', '2026-05-11']))
    expect(events).toHaveLength(1)
    expect(events[0].start_time.slice(0, 10)).toBe('2026-05-10')
    expect(events[0].end_time?.slice(0, 10)).toBe('2026-05-11')
  })

  it('three adjacent days — one continuous segment', async () => {
    const events = await fetchAndGet(course(['2026-05-10', '2026-05-11', '2026-05-12']))
    expect(events).toHaveLength(1)
    expect(events[0].start_time.slice(0, 10)).toBe('2026-05-10')
    expect(events[0].end_time?.slice(0, 10)).toBe('2026-05-12')
  })

  it('a gap splits into two segments', async () => {
    const events = await fetchAndGet(course(['2026-05-10', '2026-05-12']))
    expect(events).toHaveLength(2)
    const dates = events.map(e => [e.start_time.slice(0, 10), e.end_time?.slice(0, 10)])
    expect(dates).toContainEqual(['2026-05-10', '2026-05-10'])
    expect(dates).toContainEqual(['2026-05-12', '2026-05-12'])
  })

  it('OW-3 shape {09,10,16} — merged [09..10] + lone [16]', async () => {
    const events = await fetchAndGet(course(['2026-05-09', '2026-05-10', '2026-05-16']))
    expect(events).toHaveLength(2)
    const dates = events.map(e => [e.start_time.slice(0, 10), e.end_time?.slice(0, 10)])
    expect(dates).toContainEqual(['2026-05-09', '2026-05-10'])
    expect(dates).toContainEqual(['2026-05-16', '2026-05-16'])
  })

  it('sorts + dedupes unordered/duplicate days before grouping', async () => {
    const events = await fetchAndGet(course(['2026-05-12', '2026-05-10', '2026-05-10', '2026-05-11']))
    expect(events).toHaveLength(1)
    expect(events[0].start_time.slice(0, 10)).toBe('2026-05-10')
    expect(events[0].end_time?.slice(0, 10)).toBe('2026-05-12')
  })

  it('all segments share the course _id so any click books the same course', async () => {
    const events = await fetchAndGet(course(['2026-05-10', '2026-05-12', '2026-05-25']))
    expect(new Set(events.map(e => e.id))).toEqual(new Set(['c1']))
  })

  it('carries start_time_hhmm from the course start_time column', async () => {
    const events = await fetchAndGet(course(['2026-05-10'], { start_time: '14:30:00.000' }))
    expect(events).toHaveLength(1)
    expect(events[0].start_time_hhmm).toBe('14:30')
  })

  it('emits start_time_hhmm = null when course has no start_time set', async () => {
    const events = await fetchAndGet(course(['2026-05-10'], { start_time: '' }))
    expect(events).toHaveLength(1)
    expect(events[0].start_time_hhmm).toBeNull()
  })

  it('maps course included / schedule / prereqs into event.details', async () => {
    const events = await fetchAndGet(course(['2026-05-10'], {
      included: 'Certification, materials, 4 dives',
      schedule: 'Day 1 pool, Day 2 open water',
      prereqs: 'Able to swim 200m',
      req_dives: '10',
    }))
    expect(events).toHaveLength(1)
    const d = events[0].details
    expect(d?.included).toBe('Certification, materials, 4 dives')
    expect(d?.schedule).toBe('Day 1 pool, Day 2 open water')
    expect(d?.prerequisites).toBe('Able to swim 200m')
    expect(d?.required_dives).toBe(10)
    expect(d?.description).toBeNull()
  })

  it('leaves event.details null when the course has no descriptive content', async () => {
    const events = await fetchAndGet(course(['2026-05-10']))
    expect(events[0].details).toBeNull()
  })

  it('fetches courses by overlapping course_days against every date in the window', async () => {
    // The calendar asks for courses sharing at least one day with the
    // visible window. A course with a day before the window still renders
    // its in-window days (only those days emit segments).
    const overlapsCalls: [string, string[]][] = []
    const courseRows = [course(['2026-04-30', '2026-05-15'])]
    const courseBuilder: Record<string, unknown> = {}
    const chain = ['select', 'eq', 'lte', 'gte', 'order', 'in', 'is', 'or']
    for (const m of chain) courseBuilder[m] = () => courseBuilder
    courseBuilder.overlaps = (col: string, val: string[]) => { overlapsCalls.push([col, val]); return courseBuilder }
    courseBuilder.then = (cb?: (r: unknown) => unknown) =>
      Promise.resolve({ data: courseRows, error: null }).then(cb)

    from.mockImplementation((table: string) => {
      if (table === 'EO_courses') return courseBuilder
      const empty: Record<string, unknown> = {}
      for (const m of [...chain, 'overlaps']) empty[m] = () => empty
      empty.then = (cb?: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(cb)
      return empty
    })

    const { fetchEventsInRange } = await import('./events')
    const events = await fetchEventsInRange('2026-05-01', '2026-05-31')
    expect(overlapsCalls).toHaveLength(1)
    const [col, dates] = overlapsCalls[0]
    expect(col).toBe('course_days')
    // Inclusive enumeration of the window: first, last, and a sample middle.
    expect(dates[0]).toBe('2026-05-01')
    expect(dates[dates.length - 1]).toBe('2026-05-31')
    expect(dates).toContain('2026-05-15')
    // The 05-15 day still renders even though 04-30 is outside the window.
    expect(events.find(e => e.start_time.startsWith('2026-05-15'))).toBeDefined()
  })
})

describe('fetchEventsInRange — private dives', () => {
  // Records the .eq() filters applied to the EO_dives query so we can assert
  // whether private dives are excluded.
  function setupCaptureDiveEq() {
    const diveEq: [string, unknown][] = []
    const chain = ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is', 'or', 'overlaps']
    const make = (data: unknown, onEq?: (c: string, v: unknown) => void) => {
      const b: Record<string, unknown> = {}
      for (const m of chain) {
        b[m] = (...args: unknown[]) => { if (m === 'eq' && onEq) onEq(args[0] as string, args[1]); return b }
      }
      b.then = (cb?: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(cb)
      return b
    }
    from.mockImplementation((table: string) =>
      table === 'EO_dives' ? make([], (c, v) => diveEq.push([c, v])) : make([]))
    return diveEq
  }

  it('excludes private dives by default (diver-facing)', async () => {
    const diveEq = setupCaptureDiveEq()
    const { fetchEventsInRange } = await import('./events')
    await fetchEventsInRange('2026-05-01', '2026-05-31')
    expect(diveEq).toContainEqual(['is_private', false])
  })

  it('includes private dives when includePrivate is set (admin calendar)', async () => {
    const diveEq = setupCaptureDiveEq()
    const { fetchEventsInRange } = await import('./events')
    await fetchEventsInRange('2026-05-01', '2026-05-31', { includePrivate: true })
    expect(diveEq).not.toContainEqual(['is_private', false])
  })
})

describe('fetchEventsForBookings — full course span', () => {
  // For per-booking lookups (e.g. AdminEventDetailPage → EventStaffSection),
  // the representative event for a course must cover the full span — first
  // to last of every day the course runs on — not just the first run of
  // consecutive days. Otherwise the staff-on-duty date picker's min/max
  // bounds exclude the days outside the first run. This regressed when a
  // rescue course on May 30 + June 3 (with a gap) had its duty picker stuck
  // on May, blocking June 3 selection.
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

  it('returns one entry per course covering the full span when days split into two runs', async () => {
    setupForBookings({
      _id: 'c-split', display_title: 'Rescue', start_time: '09:00:00',
      course_days: ['2026-05-30', '2026-05-31', '2026-06-03'],
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

  it('covers the full span when the last day is detached from the rest', async () => {
    setupForBookings({
      _id: 'c-far', display_title: 'Rescue', start_time: '09:00:00',
      course_days: ['2026-05-31', '2026-06-06'],
      price: null, other_addons: null, dive_days: null,
      admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings([], ['c-far'])
    const ev = map.get('c-far')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-31')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-06-06')
  })

  it('works for a contiguous multi-day course', async () => {
    setupForBookings({
      _id: 'c-plain', display_title: 'OW', start_time: '09:00:00',
      start_date: '2026-05-10', end_date: '2026-05-12',
      course_days: ['2026-05-10', '2026-05-11', '2026-05-12'],
      price: null, other_addons: null, dive_days: null,
      admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings([], ['c-plain'])
    const ev = map.get('c-plain')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-10')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-05-12')
  })

  it('works for a single-day course', async () => {
    setupForBookings({
      _id: 'c-one', display_title: 'EFR', start_time: '09:00:00',
      start_date: '2026-05-10', end_date: '2026-05-10',
      course_days: ['2026-05-10'],
      price: null, other_addons: null, dive_days: null,
      admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings([], ['c-one'])
    const ev = map.get('c-one')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-10')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-05-10')
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

describe('isPastEvent', () => {
  const now = new Date('2026-06-18T04:00:00.000Z') // 2026-06-18 noon Taipei

  it('is true when the event day is before today (Taipei)', async () => {
    const { isPastEvent } = await import('./events')
    expect(isPastEvent({ start_time: '2026-06-17T01:00:00.000Z', end_time: null }, now)).toBe(true)
  })

  it('is false on the event day itself (can still register the morning of)', async () => {
    const { isPastEvent } = await import('./events')
    expect(isPastEvent({ start_time: '2026-06-18T00:30:00.000Z', end_time: null }, now)).toBe(false)
  })

  it('is false for a future event', async () => {
    const { isPastEvent } = await import('./events')
    expect(isPastEvent({ start_time: '2026-06-20T00:15:00.000Z', end_time: null }, now)).toBe(false)
  })

  it('uses the last day for a multi-day event', async () => {
    const { isPastEvent } = await import('./events')
    // started in the past but ends in the future → not past.
    expect(isPastEvent({ start_time: '2026-06-16T01:00:00.000Z', end_time: '2026-06-20T01:00:00.000Z' }, now)).toBe(false)
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

describe('attachEventDetails — EO_* schema drift tolerance', () => {
  // Cloud's Bubble-imported EO_courses/EO_dives can lack `prereqs`. The detail
  // select must drop just that column and retry so the remaining details still
  // render, rather than a single 42703 wiping details for every event.
  const selects: string[] = []

  function courseBuilder() {
    let cols = ''
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'gte', 'lte', 'order', 'in', 'is', 'or', 'overlaps']) b[m] = () => b
    b.select = (c: string) => { cols = c; selects.push(c); return b }
    b.then = (cb?: (r: unknown) => unknown) => {
      // The detail select includes `prereqs`; cloud rejects it. The core
      // query (COURSE_COLS) and the post-retry detail select do not.
      const res = cols.includes('prereqs')
        ? { data: null, error: { code: '42703', message: 'column EO_courses.prereqs does not exist' } }
        : { data: [{ _id: 'c9', display_title: 'AOW', start_time: '09:00:00', price: null, other_addons: null, dive_days: null, admin_title: null, calendar_title: null, course_days: ['2026-05-10'], included: '4 dives', schedule: '2 days', req_dives: '10' }], error: null }
      return Promise.resolve(res).then(cb)
    }
    return b
  }

  it('drops a missing column and still maps the surviving details', async () => {
    selects.length = 0
    from.mockImplementation((table: string) => {
      if (table === 'EO_courses') return courseBuilder()
      const empty: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is', 'or', 'overlaps']) empty[m] = () => empty
      empty.then = (cb?: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(cb)
      return empty
    })

    const { fetchEventsInRange } = await import('./events')
    const events = await fetchEventsInRange('2026-05-01', '2026-05-31')

    expect(events).toHaveLength(1)
    const d = events[0].details
    expect(d?.included).toBe('4 dives')
    expect(d?.schedule).toBe('2 days')
    expect(d?.required_dives).toBe(10)
    // The dropped column degrades to no value rather than crashing the query.
    expect(d?.prerequisites).toBeNull()
    // A first detail select carried `prereqs`; a later one retried without it.
    expect(selects.some(s => s.includes('prereqs'))).toBe(true)
    expect(selects.some(s => s.includes('included') && !s.includes('prereqs'))).toBe(true)
  })
})

describe('fetchUpcomingEventDays', () => {
  function setupDays(
    dives: { start_date: string | null }[],
    courses: { course_days: string[] | null }[],
  ) {
    from.mockImplementation((table: string) => {
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is', 'or', 'overlaps']) b[m] = () => b
      const data = table === 'EO_dives' ? dives : table === 'EO_courses' ? courses : []
      b.then = (cb?: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(cb)
      return b
    })
  }

  it('merges dive start_dates and course days into a distinct sorted list', async () => {
    setupDays(
      [{ start_date: '2026-07-12' }, { start_date: '2026-07-10' }, { start_date: '2026-07-10' }],
      [{ course_days: ['2026-07-11', '2026-07-12'] }],
    )
    const { fetchUpcomingEventDays } = await import('./events')
    const days = await fetchUpcomingEventDays('2026-07-01', '2026-07-31')
    // 07-10 deduped, 07-12 from both dive + course collapsed, sorted ascending.
    expect(days).toEqual(['2026-07-10', '2026-07-11', '2026-07-12'])
  })

  it('drops course days that fall outside the requested window', async () => {
    setupDays(
      [],
      [{ course_days: ['2026-06-30', '2026-07-05', '2026-08-01'] }],
    )
    const { fetchUpcomingEventDays } = await import('./events')
    const days = await fetchUpcomingEventDays('2026-07-01', '2026-07-31')
    expect(days).toEqual(['2026-07-05'])
  })
})
