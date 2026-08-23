import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminRefundsPage } from './AdminRefundsPage'

const { from, updateEq, updatePatch, toastSuccess, insert } = vi.hoisted(() => ({
  from: vi.fn(),
  updateEq: vi.fn(),
  updatePatch: vi.fn(),
  toastSuccess: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'admin1', role: 'admin' } }),
}))
vi.mock('../../lib/events', () => ({
  fetchEventsForBookings: vi.fn(async () => new Map([
    ['ev1', { title: 'Green Island Trip', currency: 'TWD' }],
  ])),
}))

function query(result: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'not', 'neq', 'order', 'in', 'eq', 'is']) b[m] = () => b
  b.insert = (row: unknown) => { insert(row); return Promise.resolve({ error: null }) }
  b.update = (patch: unknown) => { updatePatch(patch); return { eq: (...a: unknown[]) => { updateEq(...a); return Promise.resolve({ error: null }) } } }
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
  from.mockReset(); updateEq.mockReset(); updatePatch.mockReset(); toastSuccess.mockReset(); insert.mockReset()
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
    await user.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => expect(updateEq).toHaveBeenCalledWith('id', 'b1'))
    expect(updatePatch).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(toastSuccess).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Alice Diver')).not.toBeInTheDocument())
  })

  it('rejecting clears the request and leaves the booking alone', async () => {
    // The undo path for a diver who asked by accident: the booking keeps its
    // status, so this must NOT write `status: cancelled` the way approve does.
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Alice Diver')
    await user.click(screen.getByRole('button', { name: /reject/i }))
    await waitFor(() => expect(updateEq).toHaveBeenCalledWith('id', 'b1'))
    expect(updatePatch).toHaveBeenCalledWith({ refund_requested_at: null })
    expect(updatePatch).not.toHaveBeenCalledWith(expect.objectContaining({ status: expect.anything() }))
  })

  it('drops a rejected request off the queue', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Alice Diver')
    await user.click(screen.getByRole('button', { name: /reject/i }))
    expect(toastSuccess).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Alice Diver')).not.toBeInTheDocument())
  })
})

// The second queue: money left on a cancelled booking. Nothing else in the app
// shows it — a cancelled booking reads "settled" and drops out of the diver's
// account credit — so this list is the only place an admin can see that the
// shop is still holding a diver's cash, and the only place to resolve it.
describe('AdminRefundsPage · cancelled bookings still holding money', () => {
  const cancelled = [
    { id: 'b9', user_id: 'd1', event_id: 'ev1', status: 'cancelled', refund_requested_at: null, details: { total: 3000 } },
  ]

  function setupHolding(credits: unknown[] = []) {
    from.mockImplementation((table: string) => {
      switch (table) {
        case 'bookings': return query({ data: cancelled, error: null })
        case 'profiles': return query({ data: profiles, error: null })
        case 'payments': return query({ data: [{ booking_id: 'b9', amount: 3000, status: 'paid' }], error: null })
        case 'credits':  return query({ data: credits, error: null })
        default:         return query({ data: [], error: null })
      }
    })
  }

  it('lists the booking with the amount the shop still holds', async () => {
    setupHolding()
    renderPage()
    expect(await screen.findByText(/cancelled bookings still holding money/i)).toBeInTheDocument()
    const item = (await screen.findAllByText('Alice Diver')).at(-1)!.closest('li')!
    expect(within(item).getByText(/TWD\s*3,000/)).toBeInTheDocument()
  })

  it('records a refunded payment for the full amount when the money went back', async () => {
    setupHolding()
    vi.stubGlobal('prompt', vi.fn(() => 'BANK-77'))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^refunded$/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    expect(insert.mock.calls[0][0]).toMatchObject({
      booking_id: 'b9', user_id: 'd1', amount: 3000, status: 'refunded', reference: 'BANK-77',
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^refunded$/i })).not.toBeInTheDocument())
  })

  // A refund is the movement a diver is most likely to query later, so it is
  // the one that must never be recorded on trust alone.
  it('records nothing when the admin dismisses the reference prompt', async () => {
    setupHolding()
    vi.stubGlobal('prompt', vi.fn(() => null))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^refunded$/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^refunded$/i })).toBeInTheDocument())
    expect(insert).not.toHaveBeenCalled()
  })

  it('records nothing when the reference is left blank', async () => {
    setupHolding()
    vi.stubGlobal('prompt', vi.fn(() => '   '))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /^refunded$/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^refunded$/i })).toBeInTheDocument())
    expect(insert).not.toHaveBeenCalled()
  })

  it('issues an open credit stamped as a money return when the shop keeps it', async () => {
    setupHolding()
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /keep as credit/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    expect(insert.mock.calls[0][0]).toMatchObject({
      booking_id: 'b9', user_id: 'd1', amount: 3000, status: 'open',
      source: 'booking_cancellation_return',
    })
  })

  it('records an acknowledgement, and no money movement, when the shop keeps it', async () => {
    setupHolding()
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /keep as fee/i }))

    // Stamps the booking; inserts nothing. The cash is already recorded as a
    // paid payment on that event, so the books are right — what was missing is
    // a record that somebody decided to keep it.
    await waitFor(() => expect(updatePatch).toHaveBeenCalled())
    const patch = updatePatch.mock.calls.at(-1)![0] as Record<string, unknown>
    expect(patch.cancellation_settled_by).toBe('admin1')
    expect(patch.cancellation_settled_at).toEqual(expect.any(String))
    expect(patch.cancellation_settled_note).toMatch(/cancellation fee/i)
    expect(insert).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /keep as fee/i })).not.toBeInTheDocument())
  })

  it('says nothing is outstanding once the money has been returned', async () => {
    setupHolding([{ booking_id: 'b9', source: 'event_cancellation' }])
    renderPage()
    expect(await screen.findByText(/every cancelled booking is accounted for/i)).toBeInTheDocument()
  })
})
