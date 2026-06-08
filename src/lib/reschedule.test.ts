import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppEvent } from '../types/database'

// Captures of the .update() payloads the helper issues, plus the
// course_days the mocked select() should return for the next course read.
const updates: { table: string; payload: Record<string, unknown> }[] = []
let courseDaysData: string[] | null = []

const fromMock = vi.fn((table: string) => ({
  select: () => ({
    eq: () => ({
      single: () => Promise.resolve({ data: { course_days: courseDaysData }, error: null }),
    }),
  }),
  update: (payload: Record<string, unknown>) => {
    updates.push({ table, payload })
    return { eq: () => Promise.resolve({ error: null }) }
  },
}))
let sessionData: { access_token: string } | null = { access_token: 'jwt-123' }
vi.mock('./supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => fromMock(...(a as [string])),
    auth: { getSession: () => Promise.resolve({ data: { session: sessionData } }) },
  },
}))

beforeEach(() => {
  updates.length = 0
  courseDaysData = []
  sessionData = { access_token: 'jwt-123' }
  fromMock.mockClear()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// Midday UTC so the date doesn't shift under the runner's timezone.
function ev(partial: Partial<AppEvent>): AppEvent {
  return {
    id: 'x', type: 'dive', title: 'X', calendar_title: null,
    start_time: '2026-05-10T12:00:00.000Z', end_time: null, start_time_hhmm: null,
    ...partial,
  } as AppEvent
}

describe('isReschedulable', () => {
  it('courses are always reschedulable', async () => {
    const { isReschedulable } = await import('./reschedule')
    expect(isReschedulable({ type: 'course', start_time: '2026-05-10T12:00:00Z', end_time: '2026-05-16T12:00:00Z' })).toBe(true)
  })
  it('single-day dives (no end) are reschedulable', async () => {
    const { isReschedulable } = await import('./reschedule')
    expect(isReschedulable({ type: 'dive', start_time: '2026-05-10T12:00:00Z', end_time: null })).toBe(true)
  })
  it('single-day dives (end == start day) are reschedulable', async () => {
    const { isReschedulable } = await import('./reschedule')
    expect(isReschedulable({ type: 'dive', start_time: '2026-05-10T02:00:00Z', end_time: '2026-05-10T08:00:00Z' })).toBe(true)
  })
  it('multi-day dives are NOT reschedulable', async () => {
    const { isReschedulable } = await import('./reschedule')
    expect(isReschedulable({ type: 'dive', start_time: '2026-05-10T12:00:00Z', end_time: '2026-05-12T12:00:00Z' })).toBe(false)
  })
})

describe('replaceDayInList', () => {
  it('replaces the day, then dedupes + sorts', async () => {
    const { replaceDayInList } = await import('./reschedule')
    expect(replaceDayInList(['2026-05-09', '2026-05-10', '2026-05-16'], '2026-05-16', '2026-05-18'))
      .toEqual(['2026-05-09', '2026-05-10', '2026-05-18'])
    // Re-sorts when the moved day jumps before others.
    expect(replaceDayInList(['2026-05-10', '2026-05-16'], '2026-05-16', '2026-05-08'))
      .toEqual(['2026-05-08', '2026-05-10'])
    // Moving onto an existing day collapses the duplicate.
    expect(replaceDayInList(['2026-05-10', '2026-05-12'], '2026-05-12', '2026-05-10'))
      .toEqual(['2026-05-10'])
  })
})

describe('rescheduleEventDay', () => {
  it('course: swaps one day in course_days', async () => {
    courseDaysData = ['2026-05-09', '2026-05-10', '2026-05-16']
    const { rescheduleEventDay } = await import('./reschedule')
    await rescheduleEventDay(ev({ id: 'c1', type: 'course' }), '2026-05-16', '2026-05-18')
    expect(updates).toEqual([{
      table: 'EO_courses',
      payload: { course_days: ['2026-05-09', '2026-05-10', '2026-05-18'] },
    }])
  })

  it('course: moving the first day re-sorts course_days', async () => {
    courseDaysData = ['2026-05-09', '2026-05-10', '2026-05-16']
    const { rescheduleEventDay } = await import('./reschedule')
    await rescheduleEventDay(ev({ id: 'c1', type: 'course' }), '2026-05-09', '2026-05-20')
    expect(updates[0].payload).toEqual({
      course_days: ['2026-05-10', '2026-05-16', '2026-05-20'],
    })
  })

  it('course: no write when the dragged day is not one of the course days', async () => {
    courseDaysData = ['2026-05-09', '2026-05-10']
    const { rescheduleEventDay } = await import('./reschedule')
    await rescheduleEventDay(ev({ id: 'c1', type: 'course' }), '2026-05-25', '2026-05-26')
    expect(updates).toHaveLength(0)
  })

  it('single-day dive: moves start_date and end_date to the new day', async () => {
    const { rescheduleEventDay } = await import('./reschedule')
    await rescheduleEventDay(ev({ id: 'd1', type: 'dive', end_time: null }), '2026-05-10', '2026-05-12')
    expect(updates).toEqual([{ table: 'EO_dives', payload: { start_date: '2026-05-12', end_date: '2026-05-12' } }])
  })

  it('no-op when from === to (no DB call at all)', async () => {
    const { rescheduleEventDay } = await import('./reschedule')
    await rescheduleEventDay(ev({ id: 'd1', type: 'dive' }), '2026-05-10', '2026-05-10')
    expect(fromMock).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })
})

describe('notifyEventRescheduled', () => {
  it('POSTs the event + date payload to the worker when configured', async () => {
    vi.stubEnv('VITE_PUSH_WORKER_URL', 'http://localhost:8787/')
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { notifyEventRescheduled } = await import('./reschedule')
    await notifyEventRescheduled('c1', 'course', '2026-05-16', '2026-05-18')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8787/admin-event-reschedule')
    expect(init.headers.authorization).toBe('Bearer jwt-123')
    expect(JSON.parse(init.body)).toEqual({
      event_id: 'c1', event_type: 'course', from_date: '2026-05-16', to_date: '2026-05-18',
    })
  })

  it('no-ops (no fetch) when the worker URL is not configured', async () => {
    vi.stubEnv('VITE_PUSH_WORKER_URL', '')
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { notifyEventRescheduled } = await import('./reschedule')
    await notifyEventRescheduled('c1', 'course', '2026-05-16', '2026-05-18')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no-ops when from === to', async () => {
    vi.stubEnv('VITE_PUSH_WORKER_URL', 'http://localhost:8787')
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { notifyEventRescheduled } = await import('./reschedule')
    await notifyEventRescheduled('c1', 'course', '2026-05-16', '2026-05-16')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('notifyEventScheduleChanged', () => {
  it('POSTs only event_id + event_type (no dates) for an edit-form change', async () => {
    vi.stubEnv('VITE_PUSH_WORKER_URL', 'http://localhost:8787')
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { notifyEventScheduleChanged } = await import('./reschedule')
    await notifyEventScheduleChanged('d9', 'dive')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8787/admin-event-reschedule')
    expect(JSON.parse(init.body)).toEqual({ event_id: 'd9', event_type: 'dive' })
  })
})
