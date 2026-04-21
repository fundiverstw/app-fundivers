import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { BookingsPage } from './BookingsPage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'

const { from, useAuthMock } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
})

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const past = () => new Date(Date.now() - 7 * 86_400_000).toISOString()

function setupFrom(bookings: unknown[], events: unknown[]) {
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return mockQueryBuilder({ data: bookings })
    if (table === 'events') return mockQueryBuilder({ data: events })
    return mockQueryBuilder()
  })
}

describe('BookingsPage', () => {
  it('shows the empty state when the user has no upcoming bookings', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    setupFrom([], [])
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
    const events = [
      { id: 'd1', type: 'dive',   title: 'Future Dive',     start_time: future(), end_time: null, featured: false, fully_booked: false, price: 1500, deposit_amount: 500, currency: 'TWD' },
      { id: 'd2', type: 'dive',   title: 'Cancelled Dive',  start_time: future(), end_time: null, featured: false, fully_booked: false, price: 1500, deposit_amount: 500, currency: 'TWD' },
      { id: 'c3', type: 'course', title: 'Past Course',     start_time: past(),   end_time: null, featured: false, fully_booked: false, price: 18000, deposit_amount: 6000, currency: 'TWD' },
    ]
    setupFrom(bookings, events)

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
    from.mockImplementation(() => ({
      ...mockQueryBuilder(),
      then: () => new Promise(() => {}),
    }))
    const { container } = renderWithRouter(<BookingsPage />)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('does not query when the user is not yet available', () => {
    useAuthMock.mockReturnValue({ user: null })
    setupFrom([], [])
    renderWithRouter(<BookingsPage />)
    expect(from).not.toHaveBeenCalled()
  })

  it('renders a fallback label when the event no longer exists', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    setupFrom(
      [{ id: 'b1', user_id: 'u1', eo_dive_id: 'missing', eo_course_id: null, status: 'confirmed', notes: null, created_at: new Date().toISOString() }],
      [] // events query returns nothing
    )
    renderWithRouter(<BookingsPage />)
    expect(await screen.findByText(/event unavailable/i)).toBeInTheDocument()
  })
})
