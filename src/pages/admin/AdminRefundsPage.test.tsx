import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminRefundsPage } from './AdminRefundsPage'

const { from, updateEq, toastSuccess } = vi.hoisted(() => ({
  from: vi.fn(),
  updateEq: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../../lib/events', () => ({
  fetchEventsForBookings: vi.fn(async () => new Map([
    ['ev1', { title: 'Green Island Trip', currency: 'TWD' }],
  ])),
}))

function query(result: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'not', 'neq', 'order', 'in', 'eq']) b[m] = () => b
  b.update = () => ({ eq: (...a: unknown[]) => { updateEq(...a); return Promise.resolve({ error: null }) } })
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return b
}

const bookings = [
  { id: 'b1', user_id: 'd1', event_id: 'ev1', status: 'confirmed', refund_requested_at: '2026-07-10T02:00:00Z', details: { total: 3000 } },
]
const profiles = [{ id: 'd1', name: 'Alice Diver', nickname: null }]
const payments = [
  { booking_id: 'b1', amount: 3000, status: 'paid' },
  { booking_id: 'b1', amount: 500, status: 'refunded' },
  { booking_id: 'b1', amount: 999, status: 'voided' },
]

beforeEach(() => {
  from.mockReset(); updateEq.mockReset(); toastSuccess.mockReset()
  from.mockImplementation((table: string) => {
    switch (table) {
      case 'bookings': return query({ data: bookings, error: null })
      case 'profiles': return query({ data: profiles, error: null })
      case 'payments': return query({ data: payments, error: null })
      default:         return query({ data: [], error: null })
    }
  })
})

function renderPage() {
  return render(<MemoryRouter><AdminRefundsPage /></MemoryRouter>)
}

describe('AdminRefundsPage', () => {
  it('lists open refund requests with diver, event and net-paid amount', async () => {
    renderPage()
    const row = (await screen.findByText('Alice Diver')).closest('li')!
    expect(within(row).getByText('Green Island Trip')).toBeInTheDocument()
    // Net paid: 3000 paid − 500 refunded, voided excluded = 2500.
    expect(within(row).getByText('TWD 2,500')).toBeInTheDocument()
  })

  it('approving a refund cancels the booking and drops it from the list', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Alice Diver')
    await user.click(screen.getByRole('button', { name: /approve refund/i }))
    await waitFor(() => expect(updateEq).toHaveBeenCalledWith('id', 'b1'))
    expect(toastSuccess).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Alice Diver')).not.toBeInTheDocument())
  })
})
