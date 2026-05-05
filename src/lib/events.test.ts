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
  const chain = ['select', 'eq', 'gte', 'lte', 'order', 'in', 'is']
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
