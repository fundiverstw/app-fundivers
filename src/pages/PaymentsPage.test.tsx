import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { PaymentsPage } from './PaymentsPage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'

const from = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

const useAuthMock = vi.fn()
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
})

describe('PaymentsPage', () => {
  it('shows the empty state when no payments exist', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    renderWithRouter(<PaymentsPage />)
    expect(await screen.findByText(/no payment records/i)).toBeInTheDocument()
  })

  it('sums pending rows into "Balance due" and paid rows into "Total paid"', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({
      data: [
        { id: 'p1', user_id: 'u1', amount: 1500, currency: 'TWD', status: 'pending', method: null, note: 'Deposit', created_at: new Date().toISOString(), booking_id: null, recorded_by: null },
        { id: 'p2', user_id: 'u1', amount: 3500, currency: 'TWD', status: 'paid', method: 'cash', note: 'Course', created_at: new Date().toISOString(), booking_id: null, recorded_by: null },
        { id: 'p3', user_id: 'u1', amount: 500,  currency: 'TWD', status: 'pending', method: null, note: null, created_at: new Date().toISOString(), booking_id: null, recorded_by: null },
        { id: 'p4', user_id: 'u1', amount: 9999, currency: 'TWD', status: 'refunded', method: null, note: null, created_at: new Date().toISOString(), booking_id: null, recorded_by: null },
      ],
    }))

    renderWithRouter(<PaymentsPage />)

    // pending: 1500 + 500 = 2000 (no payment row has 2000 → appears only in summary)
    expect(await screen.findByText(/TWD\s*2,000/)).toBeInTheDocument()
    // paid: 3500 — appears in summary AND in the payment row for p2
    expect(screen.getAllByText(/TWD\s*3,500/).length).toBeGreaterThanOrEqual(2)
    // refunded shown in history but excluded from totals
    expect(screen.getByText(/refunded/i)).toBeInTheDocument()
  })

  it('shows both totals at zero when the user has no payments', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    renderWithRouter(<PaymentsPage />)
    const zeros = await screen.findAllByText(/TWD\s*0/)
    expect(zeros.length).toBeGreaterThanOrEqual(2)
  })

  it('defaults to TWD when no payments exist yet', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    renderWithRouter(<PaymentsPage />)
    // Both balance boxes show currency label
    expect((await screen.findAllByText(/TWD/)).length).toBeGreaterThanOrEqual(2)
  })
})
