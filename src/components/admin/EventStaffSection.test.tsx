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

describe('EventStaffSection date range', () => {
  it('defaults start/end to the event dates and lets admins narrow to a subset of days', async () => {
    // Initial loads: no existing duties, two admin profiles.
    from.mockImplementation((table: string) => {
      if (table === 'duties')   return mockQueryBuilder({ data: [] })
      if (table === 'profiles') return mockQueryBuilder({ data: [
        { id: 'admin-1', role: 'admin', display_name: 'Ada',   full_name: 'Ada Lovelace' },
        { id: 'admin-2', role: 'admin', display_name: 'Grace', full_name: 'Grace Hopper' },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    createDutyWithNotify.mockResolvedValue({
      duty: {
        id: 'd1', created_at: '', created_by: 'admin-1', assignee_id: 'admin-2',
        role: 'guide', start_date: '2030-02-11', end_date: '2030-02-12',
        eo_dive_id: null, eo_course_id: 'course-x', notes: null,
      },
      error: null,
    })

    const user = userEvent.setup()
    render(
      <EventStaffSection
        eventType="course"
        eventId="course-x"
        eventStartDate="2030-02-10T09:00:00Z"  // 3-day course
        eventEndDate="2030-02-12T18:00:00Z"
        nonAdminDiverCount={0}
      />
    )

    // Wait for load, then inspect the date inputs. They default to the event span.
    const startInput = await screen.findByDisplayValue('2030-02-10') as HTMLInputElement
    const endInput = screen.getByDisplayValue('2030-02-12') as HTMLInputElement
    expect(startInput.type).toBe('date')
    expect(endInput.type).toBe('date')

    // Admin narrows the range to days 2–3.
    await user.clear(startInput)
    await user.type(startInput, '2030-02-11')
    await user.clear(endInput)
    await user.type(endInput, '2030-02-12')

    // Pick the assignee and submit. Two selects in the form — assignee first.
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'admin-2')
    await user.click(screen.getByRole('button', { name: /assign/i }))

    await waitFor(() => expect(createDutyWithNotify).toHaveBeenCalledTimes(1))
    const [payload, createdBy] = createDutyWithNotify.mock.calls[0]
    expect(createdBy).toBe('admin-1')
    expect(payload).toMatchObject({
      assignee_id: 'admin-2',
      role: 'instructor',          // default for course events
      start_date: '2030-02-11',
      end_date:   '2030-02-12',
      eo_course_id: 'course-x',
    })
  })

  it('accepts a blank end date for single-day assignments', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'duties')   return mockQueryBuilder({ data: [] })
      if (table === 'profiles') return mockQueryBuilder({ data: [
        { id: 'admin-1', role: 'admin', display_name: 'Ada', full_name: 'Ada Lovelace' },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    createDutyWithNotify.mockResolvedValue({
      duty: {
        id: 'd2', created_at: '', created_by: 'admin-1', assignee_id: 'admin-1',
        role: 'guide', start_date: '2030-03-05', end_date: null,
        eo_dive_id: 'dive-y', eo_course_id: null, notes: null,
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
