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

vi.mock('../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../lib/events')>('../lib/events')
  return {
    ...actual,
    fetchEventsForBookings: (...a: unknown[]) => fetchEventsForBookings(...a),
  }
})

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
      { id: 'b1', user_id: 'u1', event_id: 'd1', status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: {} },
      { id: 'b2', user_id: 'u1', event_id: 'd2', status: 'cancelled', notes: null, created_at: new Date().toISOString(), details: {} },
      { id: 'b3', user_id: 'u1', event_id: 'c3', status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: {} },
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
            data: [{ id: 'b1', user_id: 'u1', event_id: 'd1', status: 'pending', notes: null, created_at: new Date().toISOString(), details: { total: 2800 }, refund_requested_at: null }],
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
            data: [{ id: 'b1', user_id: 'u1', event_id: 'd1', status: 'pending', notes: null, created_at: new Date().toISOString(), details: { total: 2800, deposit: 800 }, refund_requested_at: null }],
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
          data: [{ id: 'b1', user_id: 'u1', event_id: 'd1', status: 'pending', notes: null, created_at: new Date().toISOString(), details: { total: 2800 }, refund_requested_at: new Date().toISOString() }],
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
      data: [{ id: 'b1', user_id: 'u1', event_id: 'missing', status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: {}, refund_requested_at: null }]
    }))
    fetchEventsForBookings.mockResolvedValue(new Map())
    renderWithRouter(<BookingsPage />)
    expect(await screen.findByText(/event unavailable/i)).toBeInTheDocument()
  })
})

describe('BookingsPage waitlist offers', () => {
  const future24h = () => new Date(Date.now() + 23 * 3_600_000).toISOString()

  function setupWithOffer(offerExpiresAt: string | null = future24h()) {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    const booking = {
      id: 'b-wait', user_id: 'u1', event_id: 'd1',
      status: 'waitlisted', notes: null, created_at: new Date().toISOString(),
      details: {}, refund_requested_at: null,
    }
    const offer = offerExpiresAt
      ? [{ id: 'offer-1', booking_id: 'b-wait', status: 'pending', expires_at: offerExpiresAt, offered_at: new Date().toISOString(), notified_at: new Date().toISOString() }]
      : []
    from.mockImplementation((table: string) => {
      if (table === 'bookings')        return mockQueryBuilder({ data: [booking] })
      if (table === 'waitlist_offers') return mockQueryBuilder({ data: offer })
      return mockQueryBuilder({ data: [] })
    })
    fetchEventsForBookings.mockResolvedValue(new Map<string, AppEvent>([
      ['d1', ev({ id: 'd1', type: 'dive', title: 'Green Island', start_time: future() })],
    ]))
  }

  it('renders the "Spot opened" banner with an Accept button on a waitlisted booking that has a live offer', async () => {
    setupWithOffer()
    renderWithRouter(<BookingsPage />)
    await screen.findByText('Green Island')
    expect(screen.getByText(/a spot just opened up/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^accept$/i })).toBeInTheDocument()
  })

  it('does NOT render the banner on a waitlisted booking with no live offer (still on the list, no spot opened yet)', async () => {
    setupWithOffer(null)
    renderWithRouter(<BookingsPage />)
    await screen.findByText('Green Island')
    expect(screen.queryByText(/a spot just opened up/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
  })

  it('shows a remaining-time label computed at fetch time (no Date.now() during render)', async () => {
    // Offer expires in ~22 hours; the label is computed once during refetch
    // and threaded through as a prop, so the banner can render purely.
    setupWithOffer(new Date(Date.now() + 22 * 3_600_000 + 30 * 60_000).toISOString())
    renderWithRouter(<BookingsPage />)
    expect(await screen.findByText(/22h \d+m left/)).toBeInTheDocument()
  })

  it('clicking Accept calls accept_waitlist_offer RPC with the offer id', async () => {
    setupWithOffer()
    const rpc = vi.fn().mockResolvedValue({ error: null })
    // Patch supabase.rpc onto the existing mock — the test's vi.mock above
    // only stubs supabase.from, so we extend it here.
    const supabaseModule = await import('../lib/supabase')
    ;(supabaseModule.supabase as { rpc?: unknown }).rpc = rpc

    const user = userEvent.setup()
    renderWithRouter(<BookingsPage />)
    await user.click(await screen.findByRole('button', { name: /^accept$/i }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('accept_waitlist_offer', { p_offer_id: 'offer-1' }))
  })
})
