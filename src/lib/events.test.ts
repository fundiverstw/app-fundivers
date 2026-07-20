/**
 * Covers courseToEvents — a course runs on an explicit list of days
 * (course_days, max 4). Adjacent days group into one continuous segment;
 * gaps emit separate segments. The range fetch matches courses by
 * overlapping course_days against every date in the window (there is no
 * start_date/end_date envelope on a course row anymore).
 *
 * Dives and courses are one `events` table now, told apart by `kind`.
 * fetchEventsInRange still issues two kind-filtered queries (dive matches a
 * scalar start_date range; course matches by overlapping course_days), so the
 * mocked builder keys its rows off the `.eq('kind', …)` filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => { from.mockReset() })

interface EventFixture {
  id: string
  kind: 'dive' | 'course'
  display_title: string
  start_time: string | null
  course_days: string[] | null
  price: string | null
  dive_days: number | null
  admin_title?: string | null
  calendar_title?: string | null
  included?: string | null
  schedule?: string | null
  prereqs?: string | null
  req_dives?: number | null
  start_date?: string | null
  end_date?: string | null
}

const CHAIN = ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is', 'or', 'overlaps']

// A kind-aware `events` builder: rows are filtered by the kind predicate this
// query applies. Production splits the calendar fetch by temporal shape via
// `.in('kind', [...])` — matching that here matters, because a builder that
// ignores the filter hands every row to BOTH the envelope and the course-day
// query, and each event comes back doubled. `.eq('kind', …)` is still honoured
// for any single-kind query. Queries with no kind filter (e.g. the
// detail-column select) see every row.
function eventsBuilder(rows: EventFixture[]) {
  let kinds: string[] | null = null
  const b: Record<string, unknown> = {}
  for (const m of CHAIN) {
    b[m] = (...args: unknown[]) => {
      if (m === 'eq' && args[0] === 'kind') kinds = [args[1] as string]
      if (m === 'in' && args[0] === 'kind') kinds = [...(args[1] as string[])]
      return b
    }
  }
  b.then = (cb?: (r: unknown) => unknown) => {
    const data = kinds ? rows.filter(r => kinds!.includes(r.kind)) : rows
    return Promise.resolve({ data, error: null }).then(cb)
  }
  return b
}

function emptyBuilder(data: unknown = []) {
  const b: Record<string, unknown> = {}
  for (const m of CHAIN) b[m] = () => b
  b.then = (cb?: (r: unknown) => unknown) => Promise.resolve({ data, error: null }).then(cb)
  return b
}

function setup(events: EventFixture[]) {
  from.mockImplementation((table: string) =>
    table === 'events' ? eventsBuilder(events) : emptyBuilder())
}

async function fetchAndGet(row: EventFixture) {
  setup([row])
  const { fetchEventsInRange } = await import('./events')
  const events = await fetchEventsInRange('2026-05-01', '2026-05-31')
  return events
}

describe('courseToEvents — course_days run grouping', () => {
  const baseCourse: Omit<EventFixture, 'course_days'> = {
    id: 'c1',
    kind: 'course',
    display_title: 'AOW',
    start_time: '09:00:00',
    price: null,
    dive_days: null,
    admin_title: null,
    calendar_title: null,
  }

  // Convenience: build a row from its day list.
  function course(days: string[], extra: Partial<EventFixture> = {}): EventFixture {
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

  it('all segments share the course id so any click books the same course', async () => {
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
      req_dives: 10,
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
    // its in-window days.
    const overlapsCalls: [string, string[]][] = []
    const courseRows: EventFixture[] = [course(['2026-04-30', '2026-05-15'])]

    from.mockImplementation((table: string) => {
      if (table !== 'events') return emptyBuilder()
      let kinds: string[] | null = null
      const b: Record<string, unknown> = {}
      for (const m of CHAIN) {
        b[m] = (...args: unknown[]) => {
        if (m === 'eq' && args[0] === 'kind') kinds = [args[1] as string]
        if (m === 'in' && args[0] === 'kind') kinds = [...(args[1] as string[])]
        return b
      }
      }
      b.overlaps = (col: string, val: string[]) => { overlapsCalls.push([col, val]); return b }
      b.then = (cb?: (r: unknown) => unknown) => {
        const data = kinds ? courseRows.filter(r => kinds!.includes(r.kind)) : courseRows
        return Promise.resolve({ data, error: null }).then(cb)
      }
      return b
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
  // Records the .eq() filters applied to the events queries so we can assert
  // whether the dive query excludes private dives. Only the dive query sets
  // is_private; the course query never does.
  function setupCaptureEq() {
    const eqCalls: [string, unknown][] = []
    from.mockImplementation((table: string) => {
      if (table !== 'events') return emptyBuilder()
      const b: Record<string, unknown> = {}
      for (const m of CHAIN) {
        b[m] = (...args: unknown[]) => { if (m === 'eq') eqCalls.push([args[0] as string, args[1]]); return b }
      }
      b.then = (cb?: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(cb)
      return b
    })
    return eqCalls
  }

  it('excludes private dives by default (diver-facing)', async () => {
    const eqCalls = setupCaptureEq()
    const { fetchEventsInRange } = await import('./events')
    await fetchEventsInRange('2026-05-01', '2026-05-31')
    expect(eqCalls).toContainEqual(['is_private', false])
  })

  it('includes private dives when includePrivate is set (admin calendar)', async () => {
    const eqCalls = setupCaptureEq()
    const { fetchEventsInRange } = await import('./events')
    await fetchEventsInRange('2026-05-01', '2026-05-31', { includePrivate: true })
    expect(eqCalls).not.toContainEqual(['is_private', false])
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
  function setupForBookings(course: EventFixture) {
    from.mockImplementation((table: string) =>
      table === 'events' ? eventsBuilder([course]) : emptyBuilder())
  }

  it('returns one entry per course covering the full span when days split into two runs', async () => {
    setupForBookings({
      id: 'c-split', kind: 'course', display_title: 'Rescue', start_time: '09:00:00',
      course_days: ['2026-05-30', '2026-05-31', '2026-06-03'],
      price: null, dive_days: null, admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings(['c-split'])
    expect(map.size).toBe(1)
    const ev = map.get('c-split')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-30')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-06-03')
  })

  it('covers the full span when the last day is detached from the rest', async () => {
    setupForBookings({
      id: 'c-far', kind: 'course', display_title: 'Rescue', start_time: '09:00:00',
      course_days: ['2026-05-31', '2026-06-06'],
      price: null, dive_days: null, admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings(['c-far'])
    const ev = map.get('c-far')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-31')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-06-06')
  })

  it('works for a contiguous multi-day course', async () => {
    setupForBookings({
      id: 'c-plain', kind: 'course', display_title: 'OW', start_time: '09:00:00',
      start_date: '2026-05-10', end_date: '2026-05-12',
      course_days: ['2026-05-10', '2026-05-11', '2026-05-12'],
      price: null, dive_days: null, admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings(['c-plain'])
    const ev = map.get('c-plain')
    expect(ev?.start_time.slice(0, 10)).toBe('2026-05-10')
    expect(ev?.end_time?.slice(0, 10)).toBe('2026-05-12')
  })

  it('works for a single-day course', async () => {
    setupForBookings({
      id: 'c-one', kind: 'course', display_title: 'EFR', start_time: '09:00:00',
      start_date: '2026-05-10', end_date: '2026-05-10',
      course_days: ['2026-05-10'],
      price: null, dive_days: null, admin_title: null, calendar_title: null,
    })
    const { fetchEventsForBookings } = await import('./events')
    const map = await fetchEventsForBookings(['c-one'])
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

describe('toIso — shop-timezone anchoring (via diveToEvent)', () => {
  const baseDive: EventFixture = {
    id: 'd-tz', kind: 'dive', display_title: 'TZ Dive',
    start_time: '09:00:00', course_days: null, price: null, dive_days: 1,
    start_date: '2026-05-15', end_date: '2026-05-15',
  }

  it('anchors start_time to the shop timezone, not the runtime timezone', async () => {
    const [ev] = await fetchAndGet(baseDive)
    // 09:00 on 2026-05-15 in Asia/Taipei (UTC+8) is 01:00Z the same day — the
    // absolute instant is correct only if the parse is anchored to the shop tz.
    expect(ev.start_time).toBe('2026-05-15T01:00:00.000Z')
  })

  it('keeps the shop-tz calendar day equal to the source date at midnight', async () => {
    const [ev] = await fetchAndGet({ ...baseDive, start_time: '00:00:00' })
    // Midnight Taipei = 16:00Z the previous day, but read back in the shop tz it
    // is still 2026-05-15 — which is what isPastEvent compares.
    expect(ev.start_time).toBe('2026-05-14T16:00:00.000Z')
    expect(new Date(ev.start_time).toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }))
      .toBe('2026-05-15')
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

describe('attachEventDetails — events schema drift tolerance', () => {
  // Cloud's Bubble-imported rows can lack `prereqs`. The detail select must
  // drop just that column and retry so the remaining details still render,
  // rather than a single 42703 wiping details for every event.
  const selects: string[] = []

  function courseBuilder() {
    let cols = ''
    let kinds: string[] | null = null
    const b: Record<string, unknown> = {}
    for (const m of ['eq', 'gte', 'lte', 'order', 'in', 'is', 'or', 'overlaps']) {
      b[m] = (...args: unknown[]) => {
        if (m === 'eq' && args[0] === 'kind') kinds = [args[1] as string]
        if (m === 'in' && args[0] === 'kind') kinds = [...(args[1] as string[])]
        return b
      }
    }
    b.select = (c: string) => { cols = c; selects.push(c); return b }
    b.then = (cb?: (r: unknown) => unknown) => {
      // The detail select includes `prereqs`; cloud rejects it. The core
      // query (EVENT_COLS) and the post-retry detail select do not.
      if (cols.includes('prereqs')) {
        return Promise.resolve({ data: null, error: { code: '42703', message: 'column events.prereqs does not exist' } }).then(cb)
      }
      const row: EventFixture = {
        id: 'c9', kind: 'course', display_title: 'AOW', start_time: '09:00:00',
        price: null, dive_days: null, admin_title: null, calendar_title: null,
        course_days: ['2026-05-10'], included: '4 dives', schedule: '2 days', req_dives: 10,
      }
      const data = kinds ? (kinds.includes('course') ? [row] : []) : [row]
      return Promise.resolve({ data, error: null }).then(cb)
    }
    return b
  }

  it('drops a missing column and still maps the surviving details', async () => {
    selects.length = 0
    from.mockImplementation((table: string) =>
      table === 'events' ? courseBuilder() : emptyBuilder())

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
      if (table !== 'events') return emptyBuilder()
      let kinds: string[] | null = null
      const b: Record<string, unknown> = {}
      for (const m of CHAIN) {
        b[m] = (...args: unknown[]) => {
          if (m === 'eq' && args[0] === 'kind') kinds = [args[1] as string]
          if (m === 'in' && args[0] === 'kind') kinds = [...(args[1] as string[])]
          return b
        }
      }
      b.then = (cb?: (r: unknown) => unknown) => {
        // The two queries are keyed by temporal shape: the envelope query
        // (dive and any future envelope kind) reads start_date, the course-day
        // query reads course_days.
        const data = kinds?.includes('dive') ? dives : kinds?.includes('course') ? courses : []
        return Promise.resolve({ data, error: null }).then(cb)
      }
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

describe('adventure events reach the calendar', () => {
  it('fetches adventures alongside dives in the envelope query', async () => {
    // The calendar used to run one query per kind, hardcoded to dive and
    // course. A kind missing from those queries is never fetched at all, so it
    // vanishes from the calendar rather than rendering wrongly.
    setup([{
      id: 'adv1', kind: 'adventure', display_title: 'Camping weekend',
      start_time: '08:00:00', price: null, dive_days: null,
      admin_title: null, calendar_title: null, course_days: null,
      start_date: '2026-05-12', end_date: '2026-05-14',
    } as unknown as EventFixture])
    const { fetchEventsInRange } = await import('./events')
    const events = await fetchEventsInRange('2026-05-01', '2026-05-31')

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('adventure')
    expect(events[0].start_time.slice(0, 10)).toBe('2026-05-12')
    expect(events[0].end_time?.slice(0, 10)).toBe('2026-05-14')
  })

  it('counts an adventure day in the upcoming-days picker', async () => {
    setup([{
      id: 'adv2', kind: 'adventure', display_title: 'Camping',
      start_time: '08:00:00', price: null, dive_days: null,
      admin_title: null, calendar_title: null, course_days: null,
      start_date: '2026-05-20', end_date: null,
    } as unknown as EventFixture])
    const { fetchUpcomingEventDays } = await import('./events')
    expect(await fetchUpcomingEventDays('2026-05-01', '2026-05-31')).toContain('2026-05-20')
  })
})

