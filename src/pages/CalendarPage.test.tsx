import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarPage } from './CalendarPage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'
import type { AppEvent } from '../types/database'

const { from, insert, update, useAuthMock, fetchEventsInRange } = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsInRange: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

vi.mock('../lib/events', () => ({
  fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  from.mockReset()
  insert.mockReset()
  update.mockReset()
  fetchEventsInRange.mockReset()
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'u1' } })
})

function future(daysAhead = 7) {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString()
}

function buildEvent(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: overrides.id ?? 'dive_a1',
    type: overrides.type ?? 'dive',
    title: overrides.title ?? 'Green Island Dive',
    start_time: overrides.start_time ?? future(),
    end_time: overrides.end_time ?? null,
    featured: overrides.featured ?? false,
    fully_booked: overrides.fully_booked ?? false,
    price: overrides.price ?? 1500,
    currency: overrides.currency ?? 'TWD',
  }
}

function setupBookings(bookings: unknown[], inserted?: unknown) {
  from.mockImplementation(() => ({
    ...mockQueryBuilder({ data: bookings }),
    insert: (...a: unknown[]) => {
      insert(...a)
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted ?? null, error: null }),
        }),
      }
    },
    update: (...a: unknown[]) => {
      update(...a)
      return mockQueryBuilder({ data: null })
    },
  }))
}

describe('CalendarPage', () => {
  it('shows an empty state when there are no events', async () => {
    fetchEventsInRange.mockResolvedValue([])
    setupBookings([])
    renderWithRouter(<CalendarPage />)
    expect(await screen.findByText(/no events scheduled/i)).toBeInTheDocument()
  })

  it('renders events with a type badge', async () => {
    fetchEventsInRange.mockResolvedValue([buildEvent({ title: 'Beginner Course', type: 'course' })])
    setupBookings([])
    renderWithRouter(<CalendarPage />)
    expect(await screen.findByText('Beginner Course')).toBeInTheDocument()
    // "Course" appears once in the legend + once per course event → 2x here
    expect(screen.getAllByText('Course')).toHaveLength(2)
  })

  it('tags events the current user has booked', async () => {
    const ev = buildEvent({ id: 'dive_a1', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([{ id: 'b1', user_id: 'u1', eo_dive_id: 'dive_a1', eo_course_id: null, status: 'confirmed' }])
    renderWithRouter(<CalendarPage />)
    await screen.findByText(ev.title)
    expect(screen.getByText(/^booked$/i)).toBeInTheDocument()
  })

  it('opens the detail modal on click', async () => {
    const ev = buildEvent()
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(ev.title))
    expect(await screen.findByRole('button', { name: /register/i })).toBeInTheDocument()
    expect(screen.getByText(/TWD\s*1,500/)).toBeInTheDocument()
  })

  it('Register inserts with eo_dive_id for a dive event', async () => {
    const ev = buildEvent({ id: 'dive_xyz', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    const insertedRow = { id: 'b-new', user_id: 'u1', eo_dive_id: ev.id, eo_course_id: null, status: 'pending' }
    setupBookings([], insertedRow)

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(ev.title))
    await user.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    const payload = insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      user_id: 'u1',
      eo_dive_id: 'dive_xyz',
      eo_course_id: null,
      status: 'pending',
    })
  })

  it('Register inserts with eo_course_id for a course event', async () => {
    const ev = buildEvent({ id: 'course_xyz', type: 'course', title: 'AOW' })
    fetchEventsInRange.mockResolvedValue([ev])
    const insertedRow = { id: 'b-new', user_id: 'u1', eo_dive_id: null, eo_course_id: ev.id, status: 'pending' }
    setupBookings([], insertedRow)

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(ev.title))
    await user.click(screen.getByRole('button', { name: /register/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    const payload = insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      user_id: 'u1',
      eo_dive_id: null,
      eo_course_id: 'course_xyz',
      status: 'pending',
    })
  })

  it('Cancel booking updates status to cancelled', async () => {
    const ev = buildEvent({ id: 'dive_xyz', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([{ id: 'b1', user_id: 'u1', eo_dive_id: 'dive_xyz', eo_course_id: null, status: 'confirmed' }])

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(ev.title))
    await user.click(screen.getByRole('button', { name: /cancel booking/i }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0][0]).toEqual({ status: 'cancelled' })
  })

  it('disables Register for a fully-booked event', async () => {
    const ev = buildEvent({ fully_booked: true })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await user.click(await screen.findByText(ev.title))
    const btn = await screen.findByRole('button', { name: /register/i })
    expect(btn).toBeDisabled()
  })

  it('advances the month with the arrow buttons', async () => {
    fetchEventsInRange.mockResolvedValue([])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    const heading = await screen.findByRole('heading', { level: 1 })
    const initial = heading.textContent
    await user.click(screen.getByRole('button', { name: '›' }))
    await waitFor(() => expect(heading.textContent).not.toBe(initial))
  })
})
