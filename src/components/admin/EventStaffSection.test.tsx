// Pin TZ for deterministic date-picker default values. These tests assert
// specific YYYY-MM-DD strings; without pinning, they'd fail whenever the
// machine's local TZ pushes the UTC timestamps across midnight.
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventStaffSection } from './EventStaffSection'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, useAuthMock, createDutyWithNotify } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
  createDutyWithNotify: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))
vi.mock('../../lib/duties', async () => {
  const actual = await vi.importActual<typeof import('../../lib/duties')>('../../lib/duties')
  return {
    ...actual,
    createDutyWithNotify: (...a: unknown[]) => createDutyWithNotify(...a),
  }
})

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
  createDutyWithNotify.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'admin-1' } })
})

describe('EventStaffSection course day selection', () => {
  it('shows the course days as chips and creates one single-day duty per selected day', async () => {
    // Spread-out 3-day course: Feb 10, 12, 15 (non-consecutive).
    from.mockImplementation((table: string) => {
      if (table === 'duties')   return mockQueryBuilder({ data: [] })
      if (table === 'profiles') return mockQueryBuilder({ data: [
        { id: 'admin-1', role: 'admin', nickname: 'Ada',   name: 'Ada Lovelace' },
        { id: 'admin-2', role: 'admin', nickname: 'Grace', name: 'Grace Hopper' },
      ] })
      if (table === 'events') return mockQueryBuilder({
        data: { course_days: ['2030-02-10', '2030-02-12', '2030-02-15'] },
      })
      return mockQueryBuilder({ data: [] })
    })
    let n = 0
    createDutyWithNotify.mockImplementation((payload: { start_date: string }) => Promise.resolve({
      duty: {
        id: `d${++n}`, created_at: '', created_by: 'admin-1', assignee_id: 'admin-2',
        role: 'instructor', start_date: payload.start_date, end_date: null,
        event_id: 'course-x', notes: null,
      },
      error: null,
    }))

    const user = userEvent.setup()
    render(
      <EventStaffSection
        eventType="course"
        eventId="course-x"
        eventStartDate="2030-02-10T09:00:00Z"
        eventEndDate="2030-02-15T18:00:00Z"
        nonAdminDiverCount={0}
      />
    )

    // All three course days render as chips, selected by default. There are
    // no From/To date inputs for a course.
    const day10 = await screen.findByRole('button', { name: /Feb 10/ })
    await screen.findByRole('button', { name: /Feb 12/ })
    await screen.findByRole('button', { name: /Feb 15/ })
    expect(screen.queryByDisplayValue('2030-02-10')).not.toBeInTheDocument()

    // Deselect Feb 10 → assign should create duties only for Feb 12 + 15.
    await user.click(day10)
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'admin-2')
    await user.click(screen.getByRole('button', { name: /^assign$/i }))

    await waitFor(() => expect(createDutyWithNotify).toHaveBeenCalledTimes(2))
    const days = createDutyWithNotify.mock.calls.map(c => c[0].start_date).sort()
    expect(days).toEqual(['2030-02-12', '2030-02-15'])
    for (const [payload] of createDutyWithNotify.mock.calls) {
      expect(payload).toMatchObject({ assignee_id: 'admin-2', role: 'instructor', end_date: null, event_id: 'course-x' })
    }
  })

  it('defaults to the local-time date, not the UTC date (regression: Taipei-midnight events drifted back a day)', async () => {
    // Temporarily pretend we're in Taipei (UTC+8). An event whose ISO says
    // "2026-04-24T16:00:00Z" represents midnight Taipei on April 25 — the
    // calendar displays it as April 25, so the picker must too.
    const originalTZ = process.env.TZ
    process.env.TZ = 'Asia/Taipei'
    try {
      from.mockImplementation((table: string) => {
        if (table === 'duties')   return mockQueryBuilder({ data: [] })
        if (table === 'profiles') return mockQueryBuilder({ data: [
          { id: 'admin-1', role: 'admin', nickname: 'Ada', name: 'Ada Lovelace' },
        ] })
        return mockQueryBuilder({ data: [] })
      })

      render(
        <EventStaffSection
          eventType="dive"
          eventId="dive-z"
          eventStartDate="2026-04-24T16:00:00.000Z"  // 00:00 Apr 25 Taipei
          eventEndDate={null}
          nonAdminDiverCount={0}
        />
      )

      // The default should be the local (Taipei) date, not the UTC date.
      await screen.findByDisplayValue('2026-04-25')
      expect(screen.queryByDisplayValue('2026-04-24')).not.toBeInTheDocument()
    } finally {
      process.env.TZ = originalTZ
    }
  })

  it('accepts a blank end date for single-day assignments', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'duties')   return mockQueryBuilder({ data: [] })
      if (table === 'profiles') return mockQueryBuilder({ data: [
        { id: 'admin-1', role: 'admin', nickname: 'Ada', name: 'Ada Lovelace' },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    createDutyWithNotify.mockResolvedValue({
      duty: {
        id: 'd2', created_at: '', created_by: 'admin-1', assignee_id: 'admin-1',
        role: 'guide', start_date: '2030-03-05', end_date: null,
        event_id: 'dive-y', notes: null,
      },
      error: null,
    })

    const user = userEvent.setup()
    render(
      <EventStaffSection
        eventType="dive"
        eventId="dive-y"
        eventStartDate="2030-03-05T09:00:00Z"
        eventEndDate={null}
        nonAdminDiverCount={0}
      />
    )

    await screen.findByDisplayValue('2030-03-05')
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'admin-1')
    await user.click(screen.getByRole('button', { name: /assign/i }))

    await waitFor(() => expect(createDutyWithNotify).toHaveBeenCalledTimes(1))
    const [payload] = createDutyWithNotify.mock.calls[0]
    expect(payload.start_date).toBe('2030-03-05')
    // Empty input → null in the payload (matches DB nullability).
    expect(payload.end_date).toBeNull()
  })
})
