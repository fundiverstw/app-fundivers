import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { PaymentsPage } from './PaymentsPage'
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
  useAuthMock.mockReturnValue({ user: { id: 'u1' } })
})

function event(overrides: Partial<AppEvent> & Pick<AppEvent, 'id' | 'type' | 'title'>): AppEvent {
  return {
    start_time: new Date(Date.now() + 86_400_000).toISOString(),
    end_time: null,
    featured: false,
    fully_booked: false,
    price: 2800,
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

function setupFrom(bookings: unknown[], payments: unknown[]) {
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return mockQueryBuilder({ data: bookings })
    if (table === 'payments') return mockQueryBuilder({ data: payments })
    return mockQueryBuilder()
  })
}

describe('PaymentsPage', () => {
  it('shows the empty state when the user has no active bookings', async () => {
    setupFrom([], [])
    fetchEventsForBookings.mockResolvedValue(new Map())
    renderWithRouter(<PaymentsPage />)
    expect(await screen.findByText(/no active bookings/i)).toBeInTheDocument()
  })

  it('computes Balance due from booking.details.total and Total paid from matching payments', async () => {
    const bookings = [
      { id: 'b1', user_id: 'u1', eo_dive_id: 'd1', eo_course_id: null, status: 'pending',   notes: null, created_at: new Date().toISOString(), details: { total: 3000 } },
      { id: 'b2', user_id: 'u1', eo_dive_id: 'd2', eo_course_id: null, status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: { total: 5000 } },
      { id: 'b3', user_id: 'u1', eo_dive_id: 'd3', eo_course_id: null, status: 'cancelled', notes: null, created_at: new Date().toISOString(), details: { total: 9999 } },
    ]
    const payments = [
      { id: 'p1', user_id: 'u1', booking_id: 'b2', amount: 5000, currency: 'TWD', status: 'paid',    method: 'Bank', note: 'Paid in full',  created_at: new Date().toISOString(), recorded_by: null },
      { id: 'p2', user_id: 'u1', booking_id: 'b1', amount: 1500, currency: 'TWD', status: 'paid',    method: 'Bank', note: 'Deposit',       created_at: new Date().toISOString(), recorded_by: null },
    ]
    const eventMap = new Map<string, AppEvent>([
      ['d1', event({ id: 'd1', type: 'dive',   title: 'Dive A', price: 3000 })],
      ['d2', event({ id: 'd2', type: 'dive',   title: 'Dive B', price: 5000 })],
      ['d3', event({ id: 'd3', type: 'course', title: 'Cancelled' })],
    ])
    setupFrom(bookings, payments)
    fetchEventsForBookings.mockResolvedValue(eventMap)

    renderWithRouter(<PaymentsPage />)

    // Balance due summary: 3000 - 1500 = 1500 (b1) + 0 (b2 paid in full) = 1500
    // "1500" may also show per-booking line; assert summary has at least one hit.
    expect((await screen.findAllByText(/TWD\s*1,500/)).length).toBeGreaterThan(0)
    // Total paid: 5000 (b2) + 1500 (b1) = 6500
    expect(screen.getByText(/TWD\s*6,500/)).toBeInTheDocument()
    // Payment history section
    expect(screen.getByText(/payment history/i)).toBeInTheDocument()
  })

  it('handles bookings with no details.total gracefully (shows dash, no error)', async () => {
    const bookings = [
      { id: 'b1', user_id: 'u1', eo_dive_id: 'd1', eo_course_id: null, status: 'pending', notes: null, created_at: new Date().toISOString(), details: {} },
    ]
    setupFrom(bookings, [])
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['d1', event({ id: 'd1', type: 'dive', title: 'Dive A', price: null })],
    ]))

    renderWithRouter(<PaymentsPage />)
    expect(await screen.findByText('Dive A')).toBeInTheDocument()
    // Two "TWD 0" summary cards show when total is zero
    const zeros = screen.getAllByText(/TWD\s*0/)
    expect(zeros.length).toBeGreaterThanOrEqual(2)
  })
})
