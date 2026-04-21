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
    // Title appears on both the calendar bar and the "This month" list
    const matches = await screen.findAllByText('Beginner Course')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // Legend + list badge = at least 2 "Course" labels
    expect(screen.getAllByText('Course').length).toBeGreaterThanOrEqual(2)
  })

  it('tags events the current user has booked', async () => {
    const ev = buildEvent({ id: 'dive_a1', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([{ id: 'b1', user_id: 'u1', eo_dive_id: 'dive_a1', eo_course_id: null, status: 'confirmed' }])
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    expect(screen.getByText(/^booked$/i)).toBeInTheDocument()
  })

  it('opens the detail modal on click', async () => {
    const ev = buildEvent()
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
    expect(await screen.findByRole('button', { name: /register/i })).toBeInTheDocument()
    expect(screen.getByText(/TWD\s*1,500/)).toBeInTheDocument()
  })

  it('Register opens the multi-step register form', async () => {
    const ev = buildEvent({ id: 'dive_xyz', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([])

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
    await user.click(screen.getByRole('button', { name: /register/i }))

    expect(await screen.findByText(/step 1 of 3/i)).toBeInTheDocument()
    // The event detail modal closes; only the register form is now visible.
    expect(screen.queryByRole('button', { name: /^register$/i })).not.toBeInTheDocument()
  })

  it('Cancel booking updates status to cancelled', async () => {
    const ev = buildEvent({ id: 'dive_xyz', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([{ id: 'b1', user_id: 'u1', eo_dive_id: 'dive_xyz', eo_course_id: null, status: 'confirmed' }])

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
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
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
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
