import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { BookingsPage } from './BookingsPage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'
import type { AppEvent } from '../types/database'

const { from, useAuthMock, fetchEventsForBookings } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsForBookings: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

vi.mock('../lib/events', () => ({
  fetchEventsForBookings: (...a: unknown[]) => fetchEventsForBookings(...a),
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  from.mockReset()
  fetchEventsForBookings.mockReset()
  useAuthMock.mockReset()
})

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const past = () => new Date(Date.now() - 7 * 86_400_000).toISOString()

function ev(overrides: Partial<AppEvent> & Pick<AppEvent, 'id' | 'type' | 'title' | 'start_time'>): AppEvent {
  return {
    end_time: null,
    featured: false,
    fully_booked: false,
    price: 1500,
    currency: 'TWD',
    ...overrides,
  }
}

describe('BookingsPage', () => {
  it('shows the empty state when the user has no upcoming bookings', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    fetchEventsForBookings.mockResolvedValue(new Map())
    renderWithRouter(<BookingsPage />)
    expect(await screen.findByText(/no upcoming bookings/i)).toBeInTheDocument()
  })

  it('joins bookings to events and groups them upcoming vs past/cancelled', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    const bookings = [
      { id: 'b1', user_id: 'u1', eo_dive_id: 'd1', eo_course_id: null, status: 'confirmed', notes: null, created_at: new Date().toISOString() },
      { id: 'b2', user_id: 'u1', eo_dive_id: 'd2', eo_course_id: null, status: 'cancelled', notes: null, created_at: new Date().toISOString() },
      { id: 'b3', user_id: 'u1', eo_dive_id: null, eo_course_id: 'c3', status: 'confirmed', notes: null, created_at: new Date().toISOString() },
    ]
    from.mockReturnValue(mockQueryBuilder({ data: bookings }))
    fetchEventsForBookings.mockResolvedValue(new Map<string, AppEvent>([
      ['d1', ev({ id: 'd1', type: 'dive',   title: 'Future Dive',    start_time: future() })],
      ['d2', ev({ id: 'd2', type: 'dive',   title: 'Cancelled Dive', start_time: future() })],
      ['c3', ev({ id: 'c3', type: 'course', title: 'Past Course',    start_time: past() })],
    ]))

    renderWithRouter(<BookingsPage />)

    await screen.findByText('Future Dive')
    expect(screen.getByText('Future Dive')).toBeInTheDocument()
    expect(screen.getByText('Cancelled Dive')).toBeInTheDocument()
    expect(screen.getByText('Past Course')).toBeInTheDocument()
    expect(screen.getByText(/past \/ cancelled/i)).toBeInTheDocument()
  })

  it('shows a spinner while loading', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    // Bookings query never resolves — keep loading
    from.mockReturnValue({
      ...mockQueryBuilder(),
      then: () => new Promise(() => {}),
    })
    fetchEventsForBookings.mockResolvedValue(new Map())
    const { container } = renderWithRouter(<BookingsPage />)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('does not query when the user is not yet available', () => {
    useAuthMock.mockReturnValue({ user: null })
    renderWithRouter(<BookingsPage />)
    expect(from).not.toHaveBeenCalled()
    expect(fetchEventsForBookings).not.toHaveBeenCalled()
  })

  it('renders a fallback label when the event no longer exists', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({
      data: [{ id: 'b1', user_id: 'u1', eo_dive_id: 'missing', eo_course_id: null, status: 'confirmed', notes: null, created_at: new Date().toISOString() }]
    }))
    fetchEventsForBookings.mockResolvedValue(new Map())
    renderWithRouter(<BookingsPage />)
    expect(await screen.findByText(/event unavailable/i)).toBeInTheDocument()
  })
})
