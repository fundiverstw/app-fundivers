import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PaymentsPage } from './PaymentsPage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'
import type { AppEvent } from '../types/database'

const { from, rpc, useAuthMock, fetchEventsForBookings } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsForBookings: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

const toastSuccess = vi.fn()
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn() }),
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
  rpc.mockReset()
  toastSuccess.mockReset()
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

function setupFrom(bookings: unknown[], payments: unknown[], credits: unknown[] = [], profiles: unknown[] = []) {
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return mockQueryBuilder({ data: bookings })
    if (table === 'payments') return mockQueryBuilder({ data: payments })
    if (table === 'credits') return mockQueryBuilder({ data: credits })
    if (table === 'profiles') return mockQueryBuilder({ data: profiles })
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
      { id: 'b1', user_id: 'u1', event_id: 'd1', status: 'pending',   notes: null, created_at: new Date().toISOString(), details: { total: 3000 } },
      { id: 'b2', user_id: 'u1', event_id: 'd2', status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: { total: 5000 } },
      { id: 'b3', user_id: 'u1', event_id: 'd3', status: 'cancelled', notes: null, created_at: new Date().toISOString(), details: { total: 9999 } },
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
    // Payment history now lives inside the expanded card — assert at least the summary renders.
    expect(screen.getByText(/Dive B/)).toBeInTheDocument()
  })

  it('shows no deposit due once a discounted booking is paid in full', async () => {
    // The reported bug, verbatim: a diver saw "Total 2600 · Paid 2600 ·
    // Balance settled" sitting beside "Deposit 400 due". The deposit is frozen
    // at booking time and amendments never touch it, so a 400 discount left it
    // demanding the difference — money nobody owed.
    const bookings = [
      { id: 'b1', user_id: 'u1', event_id: 'd1', status: 'confirmed', notes: null,
        created_at: new Date().toISOString(), details: { total: 3000, deposit: 3000 } },
    ]
    const payments = [
      { id: 'p1', user_id: 'u1', booking_id: 'b1', amount: 2600, currency: 'TWD', status: 'paid',
        method: 'Bank', note: 'Paid in full', created_at: new Date().toISOString(), recorded_by: null },
    ]
    const amendments = [
      { id: 'a1', booking_id: 'b1', amount: -400, note: 'Loyalty discount',
        created_by: 'admin', created_at: new Date().toISOString() },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings')           return mockQueryBuilder({ data: bookings })
      if (table === 'payments')           return mockQueryBuilder({ data: payments })
      if (table === 'booking_amendments') return mockQueryBuilder({ data: amendments })
      return mockQueryBuilder({ data: [] })
    })
    fetchEventsForBookings.mockResolvedValue(new Map<string, AppEvent>([
      ['d1', event({ id: 'd1', type: 'dive', title: 'Discounted Dive', price: 3000 })],
    ]))

    renderWithRouter(<PaymentsPage />)
    await screen.findByText(/Discounted Dive/)

    // Settled, and nothing anywhere on the page claims an outstanding deposit.
    expect(screen.queryByText(/400\s*due/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/TWD\s*400/)).not.toBeInTheDocument()
  })

  it('lets a diver apply available account credit to a booking with a balance due', async () => {
    const bookings = [
      { id: 'b1', user_id: 'u1', event_id: 'd1', status: 'pending', notes: null, created_at: new Date().toISOString(), details: { total: 3000 } },
    ]
    const credits = [
      { id: 'c1', user_id: 'u1', booking_id: null, amount: 2000, currency: 'TWD', reason: 'Cancelled trip', status: 'open', created_by: null, created_at: new Date().toISOString(), settled_at: null, settled_note: null },
    ]
    setupFrom(bookings, [], credits)
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['d1', event({ id: 'd1', type: 'dive', title: 'Dive A', price: 3000 })],
    ]))
    rpc.mockResolvedValue({ data: 2000, error: null })

    const user = userEvent.setup()
    renderWithRouter(<PaymentsPage />)

    // Expand the booking card to reveal the apply-credit control.
    await user.click(await screen.findByText('Dive A'))
    const applyBtn = await screen.findByRole('button', { name: /apply credit/i })
    await user.click(applyBtn)

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('apply_credit_to_booking', { p_booking_id: 'b1', p_amount: 2000 }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('offers a top-level button to apply account credit across due balances', async () => {
    const bookings = [
      { id: 'b1', user_id: 'u1', event_id: 'd1', status: 'pending', notes: null, created_at: new Date(Date.now() - 2000).toISOString(), details: { total: 3000 } },
    ]
    const credits = [
      { id: 'c1', user_id: 'u1', booking_id: null, amount: 2000, currency: 'TWD', reason: 'Cancelled trip', status: 'open', created_by: null, created_at: new Date().toISOString(), settled_at: null, settled_note: null },
    ]
    setupFrom(bookings, [], credits)
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['d1', event({ id: 'd1', type: 'dive', title: 'Dive A', price: 3000 })],
    ]))
    rpc.mockResolvedValue({ data: 2000, error: null })

    const user = userEvent.setup()
    renderWithRouter(<PaymentsPage />)

    // The banner surfaces the apply action without expanding any card.
    const useBtn = await screen.findByRole('button', { name: /use .* credit on your balance/i })
    await user.click(useBtn)

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('apply_credit_to_booking', { p_booking_id: 'b1', p_amount: 3000 }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
  })

  it('rolls a lead booker\'s family group into one consolidated balance', async () => {
    // u1 (parent) pays for their own booking + their child's; both payer_id=u1.
    const bookings = [
      { id: 'b1', user_id: 'u1', payer_id: 'u1', group_id: 'g1', event_id: 'd1', status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: { total: 3000 } },
      { id: 'b2', user_id: 'c1', payer_id: 'u1', group_id: 'g1', event_id: 'd1', status: 'pending',   notes: null, created_at: new Date().toISOString(), details: { total: 3000 } },
    ]
    const payments = [
      { id: 'p1', user_id: 'u1', booking_id: 'b1', amount: 3000, currency: 'TWD', status: 'paid', method: 'Bank', note: null, created_at: new Date().toISOString(), recorded_by: null },
    ]
    const profiles = [
      { id: 'u1', name: 'Parent Pat', nickname: null },
      { id: 'c1', name: 'Kid Casey', nickname: null },
    ]
    setupFrom(bookings, payments, [], profiles)
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['d1', event({ id: 'd1', type: 'dive', title: 'Kenting', price: 3000 })],
    ]))

    const user = userEvent.setup()
    renderWithRouter(<PaymentsPage />)

    // The group card shows a combined balance (owed 6000, paid 3000 → 3000 due).
    await screen.findByText(/group of 2 bookings/i)
    // Child is named in the collapsed roster; parent shows as "You".
    expect(screen.getByText(/You, Kid Casey/)).toBeInTheDocument()
    await user.click(screen.getByText(/group of 2 bookings/i))
    // Expanding reveals the per-member balance breakdown.
    expect(await screen.findByText('Group balance')).toBeInTheDocument()
    // Balance-due summary reflects the group (3000 still owed).
    expect((await screen.findAllByText(/TWD\s*3,000/)).length).toBeGreaterThan(0)
  })

  it('shows a child "Covered by [lead]" with nothing due and no controls', async () => {
    // Viewer is the child c1; their booking is paid by parent u1.
    useAuthMock.mockReturnValue({ user: { id: 'c1' } })
    const bookings = [
      { id: 'b1', user_id: 'c1', payer_id: 'u1', group_id: 'g1', event_id: 'd1', status: 'confirmed', notes: null, created_at: new Date().toISOString(), details: { total: 3000 } },
    ]
    const profiles = [
      { id: 'c1', name: 'Kid Casey', nickname: null },
      { id: 'u1', name: 'Parent Pat', nickname: null },
    ]
    setupFrom(bookings, [], [], profiles)
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['d1', event({ id: 'd1', type: 'dive', title: 'Kenting', price: 3000 })],
    ]))

    renderWithRouter(<PaymentsPage />)

    expect(await screen.findByText(/covered by parent pat/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing due/i)).toBeInTheDocument()
    // No refund / apply-credit controls for a covered booking.
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /apply credit/i })).not.toBeInTheDocument()
  })

  it('handles bookings with no details.total gracefully (shows dash, no error)', async () => {
    const bookings = [
      { id: 'b1', user_id: 'u1', event_id: 'd1', status: 'pending', notes: null, created_at: new Date().toISOString(), details: {} },
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
