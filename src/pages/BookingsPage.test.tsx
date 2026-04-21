import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    deposit_amount: null,
    currency: 'TWD',
    has_rooms: false,
    room_type_ids: [],
    has_addons: false,
    addon_ids: [],
    gear_rental_info: null,
    nitrox_required: false,
    dive_days: null,
    ...overrides,
  }
}

const { update } = vi.hoisted(() => ({ update: vi.fn() }))

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
      { id: 'b1', user_id: 'u1', eo_dive_id: 'd1', eo_course_id: null, status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: {} },
      { id: 'b2', user_id: 'u1', eo_dive_id: 'd2', eo_course_id: null, status: 'cancelled', notes: null, created_at: new Date().toISOString(), details: {} },
      { id: 'b3', user_id: 'u1', eo_dive_id: null, eo_course_id: 'c3', status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: {} },
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

  it('shows Cancel button for pending booking with no payments, and calls update', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    update.mockReset()
    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          ...mockQueryBuilder({
            data: [{ id: 'b1', user_id: 'u1', eo_dive_id: 'd1', eo_course_id: null, status: 'pending', notes: null, created_at: new Date().toISOString(), details: { total: 2800 }, refund_requested_at: null }],
          }),
          update: (...a: unknown[]) => { update(...a); return mockQueryBuilder() },
        }
      }
      return mockQueryBuilder({ data: [] })
    })
    fetchEventsForBookings.mockResolvedValue(new Map<string, AppEvent>([
      ['d1', ev({ id: 'd1', type: 'dive', title: 'Kenting Dive', start_time: future() })],
    ]))

    const user = userEvent.setup()
    renderWithRouter(<BookingsPage />)
    await user.click(await screen.findByText('Kenting Dive'))
    await user.click(screen.getByRole('button', { name: /cancel booking/i }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ status: 'cancelled' }))
  })

  it('shows Request refund button when there is a paid payment, and calls update with refund_requested_at', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    update.mockReset()
    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          ...mockQueryBuilder({
            data: [{ id: 'b1', user_id: 'u1', eo_dive_id: 'd1', eo_course_id: null, status: 'pending', notes: null, created_at: new Date().toISOString(), details: { total: 2800, deposit: 800 }, refund_requested_at: null }],
          }),
          update: (...a: unknown[]) => { update(...a); return mockQueryBuilder() },
        }
      }
      // payments
      return mockQueryBuilder({ data: [{ id: 'p1', user_id: 'u1', booking_id: 'b1', amount: 800, currency: 'TWD', status: 'paid', method: 'Bank', note: null, created_at: new Date().toISOString(), recorded_by: null }] })
    })
    fetchEventsForBookings.mockResolvedValue(new Map<string, AppEvent>([
      ['d1', ev({ id: 'd1', type: 'dive', title: 'Penghu', start_time: future() })],
    ]))

    const user = userEvent.setup()
    renderWithRouter(<BookingsPage />)
    await user.click(await screen.findByText('Penghu'))
    // Cancel should NOT be visible (deposit has been paid)
    expect(screen.queryByRole('button', { name: /cancel booking/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /request refund/i }))

    await waitFor(() => {
      const call = update.mock.calls[update.mock.calls.length - 1]?.[0] as Record<string, unknown> | undefined
      expect(call?.refund_requested_at).toBeTruthy()
    })
  })

  it('shows "Refund requested" indicator and hides refund button once requested', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return mockQueryBuilder({
          data: [{ id: 'b1', user_id: 'u1', eo_dive_id: 'd1', eo_course_id: null, status: 'pending', notes: null, created_at: new Date().toISOString(), details: { total: 2800 }, refund_requested_at: new Date().toISOString() }],
        })
      }
      return mockQueryBuilder({ data: [{ id: 'p1', user_id: 'u1', booking_id: 'b1', amount: 800, status: 'paid', currency: 'TWD', method: null, note: null, created_at: new Date().toISOString(), recorded_by: null }] })
    })
    fetchEventsForBookings.mockResolvedValue(new Map<string, AppEvent>([
      ['d1', ev({ id: 'd1', type: 'dive', title: 'Dive', start_time: future() })],
    ]))

    const user = userEvent.setup()
    renderWithRouter(<BookingsPage />)
    await user.click(await screen.findByText('Dive'))
    expect(screen.getByText(/refund requested/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /request refund/i })).not.toBeInTheDocument()
  })

  it('renders a fallback label when the event no longer exists', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({
      data: [{ id: 'b1', user_id: 'u1', eo_dive_id: 'missing', eo_course_id: null, status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: {}, refund_requested_at: null }]
    }))
    fetchEventsForBookings.mockResolvedValue(new Map())
    renderWithRouter(<BookingsPage />)
    expect(await screen.findByText(/event unavailable/i)).toBeInTheDocument()
  })
})
