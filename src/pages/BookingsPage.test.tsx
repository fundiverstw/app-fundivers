import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { BookingsPage } from './BookingsPage'
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

const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString()
const past = () => new Date(Date.now() - 7 * 86_400_000).toISOString()

describe('BookingsPage', () => {
  it('shows the empty-state copy when the user has no upcoming bookings', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({ data: [] }))

    renderWithRouter(<BookingsPage />)
    expect(await screen.findByText(/no upcoming bookings/i)).toBeInTheDocument()
  })

  it('splits bookings into upcoming (future + non-cancelled) and past/cancelled', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    from.mockReturnValue(mockQueryBuilder({
      data: [
        { id: 'b1', status: 'confirmed', activity: { id: 'a1', title: 'Future Dive', start_time: future(), location: 'Green Island', type: 'dive' } },
        { id: 'b2', status: 'cancelled', activity: { id: 'a2', title: 'Cancelled Dive', start_time: future(), location: null, type: 'dive' } },
        { id: 'b3', status: 'confirmed', activity: { id: 'a3', title: 'Past Dive', start_time: past(), location: null, type: 'dive' } },
      ],
    }))

    renderWithRouter(<BookingsPage />)

    await screen.findByText('Future Dive')
    expect(screen.getByText('Future Dive')).toBeInTheDocument()
    expect(screen.getByText('Past Dive')).toBeInTheDocument()
    expect(screen.getByText('Cancelled Dive')).toBeInTheDocument()
    expect(screen.getByText(/past \/ cancelled/i)).toBeInTheDocument()
  })

  it('shows the spinner while loading', () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' } })
    // Never resolves — keep loading state
    from.mockReturnValue({
      ...mockQueryBuilder(),
      then: () => new Promise(() => {}),
    })
    const { container } = renderWithRouter(<BookingsPage />)
    expect(container.querySelector('.animate-spin')).toBeTruthy()
  })

  it('does not query when user is not yet available', () => {
    useAuthMock.mockReturnValue({ user: null })
    from.mockReturnValue(mockQueryBuilder())
    renderWithRouter(<BookingsPage />)
    expect(from).not.toHaveBeenCalled()
  })
})
