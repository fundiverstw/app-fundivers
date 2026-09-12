import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminDiscountsPage } from './AdminDiscountsPage'

const { from, rpc, toastSuccess, toastError, insert, updatePatch } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  insert: vi.fn(),
  updatePatch: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'admin1', role: 'admin' } }),
}))

function query(result: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'not', 'neq', 'is']) b[m] = () => b
  b.insert = (row: unknown) => { insert(row); return Promise.resolve({ error: null }) }
  b.update = (patch: unknown) => { updatePatch(patch); return { eq: () => Promise.resolve({ error: null }) } }
  b.delete = () => ({ eq: () => Promise.resolve({ error: null }) })
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej)
  return b
}

const discounts = [
  {
    id: 'dsc1', created_at: '2026-09-01T00:00:00Z', created_by: null,
    label: 'Student', description: 'With a valid student card',
    kind: 'percent', value: 10, active: true, sort_order: 0,
  },
]
const requests = [
  {
    id: 'req1', booking_id: 'b1', discount_id: 'dsc1', status: 'requested',
    note: 'card attached', requested_at: '2026-09-10T02:00:00Z', requested_by: 'd1',
    decided_at: null, decided_by: null, amount: null, amendment_id: null,
  },
]
const bookings = [
  { id: 'b1', user_id: 'd1', event_id: 'ev1', status: 'pending', details: { total: 3000 } },
]

beforeEach(() => {
  from.mockReset(); rpc.mockReset(); toastSuccess.mockReset(); toastError.mockReset()
  insert.mockReset(); updatePatch.mockReset()
  from.mockImplementation((table: string) => {
    switch (table) {
      case 'booking_discounts': return query({ data: requests, error: null })
      case 'discounts':         return query({ data: discounts, error: null })
      case 'bookings':          return query({ data: bookings, error: null })
      case 'profiles':          return query({ data: [{ id: 'd1', name: 'Alice Diver', nickname: null }], error: null })
      case 'events':            return query({ data: [{ id: 'ev1', display_title: 'Green Island Trip', admin_title: null }], error: null })
      default:                  return query({ data: [], error: null })
    }
  })
  rpc.mockResolvedValue({ data: 300, error: null })
})

const renderPage = () => render(<MemoryRouter><AdminDiscountsPage /></MemoryRouter>)

describe('AdminDiscountsPage', () => {
  it('shows an open request with the diver, the event and what approving would cost', async () => {
    renderPage()
    const row = (await screen.findByText('Alice Diver')).closest('li')!
    expect(within(row).getByText('Green Island Trip')).toBeInTheDocument()
    // 10% of the booking's frozen 3000 total.
    expect(within(row).getByText(/300/)).toBeInTheDocument()
    expect(within(row).getByText('card attached')).toBeInTheDocument()
  })

  it('approving calls the decide RPC and drops the row', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Alice Diver')
    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('decide_booking_discount', {
      p_request_id: 'req1', p_approve: true, p_note: null,
    }))
    expect(toastSuccess).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Alice Diver')).not.toBeInTheDocument())
  })

  it('rejecting asks for a reason and sends it, because the diver is told', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('prompt', vi.fn(() => 'no card shown'))
    renderPage()
    await screen.findByText('Alice Diver')
    await user.click(screen.getByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('decide_booking_discount', {
      p_request_id: 'req1', p_approve: false, p_note: 'no card shown',
    }))
  })

  it('decides nothing when the reason prompt is dismissed', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('prompt', vi.fn(() => null))
    renderPage()
    await screen.findByText('Alice Diver')
    await user.click(screen.getByRole('button', { name: /^reject$/i }))
    expect(rpc).not.toHaveBeenCalled()
  })

  it('lists the catalog with what each discount takes off', async () => {
    renderPage()
    await screen.findByText('With a valid student card')
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('saves a new discount from the form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('With a valid student card')
    await user.click(screen.getByRole('button', { name: /new discount/i }))
    await user.type(screen.getByLabelText(/name/i), 'Returning diver')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    expect(insert.mock.calls[0][0]).toMatchObject({
      label: 'Returning diver', kind: 'percent', value: 10, active: true,
    })
  })

  it('refuses a percent above 100 rather than sending it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('With a valid student card')
    await user.click(screen.getByRole('button', { name: /new discount/i }))
    await user.type(screen.getByLabelText(/name/i), 'Everything free')
    // The value box and the sort-order box are the page's two number inputs,
    // in that order.
    const value = screen.getAllByRole('spinbutton')[0]
    await user.clear(value)
    await user.type(value, '150')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(insert).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
  })
})
