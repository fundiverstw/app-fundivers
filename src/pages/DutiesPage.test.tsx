import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DutiesPage } from './DutiesPage'
import { mockQueryBuilder } from '../../tests/test-utils'

const { from, useAuthMock, fetchEventsInRange } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsInRange: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../lib/events')>('../lib/events')
  return {
    ...actual,
    fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  }
})
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
  fetchEventsInRange.mockReset()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <DutiesPage />
    </MemoryRouter>
  )
}

describe('DutiesPage', () => {
  it('shows the staff user only their own duties, ordered upcoming → past', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'staff-1' },
      profile: { id: 'staff-1', role: 'staff' },
    })

    // RLS on the actual cloud restricts to assignee_id = self; this mock
    // mirrors that — the supabase client returns only the staff's rows.
    const myDuties = [
      {
        id: 'd-future', created_at: '', created_by: 'admin-1', assignee_id: 'staff-1',
        role: 'guide', start_date: '2099-06-15', end_date: null,
        event_id: 'dive-a', notes: null,
      },
      {
        id: 'd-past', created_at: '', created_by: 'admin-1', assignee_id: 'staff-1',
        role: 'support', start_date: '2020-01-05', end_date: null,
        event_id: 'dive-b', notes: 'Old gig',
      },
    ]
    const events = [
      { id: 'dive-a', type: 'dive', title: 'Future Dive', start_time: '2099-06-15T09:00:00Z', end_time: null, fully_booked: false, price: null, deposit_amount: null, currency: 'TWD', featured: false },
      { id: 'dive-b', type: 'dive', title: 'Past Dive',   start_time: '2020-01-05T09:00:00Z', end_time: null, fully_booked: false, price: null, deposit_amount: null, currency: 'TWD', featured: false },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'duties') return mockQueryBuilder({ data: myDuties })
      return mockQueryBuilder({ data: [] })
    })
    fetchEventsInRange.mockResolvedValue(events)

    renderPage()

    await screen.findByText('Upcoming')
    expect(screen.getByText('Past')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Future Dive/ })).toBeInTheDocument()
    expect(screen.getByText(/Past Dive/)).toBeInTheDocument()
    expect(screen.getByText(/Old gig/)).toBeInTheDocument()

    // Staff/admin can deep-link to /admin/events; divers cannot.
    expect(screen.getByRole('link', { name: /Future Dive/ }))
      .toHaveAttribute('href', '/admin/events/dive/dive-a')
  })

  it('shows the empty state when the user has no upcoming duties', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'staff-1' },
      profile: { id: 'staff-1', role: 'staff' },
    })
    from.mockImplementation(() => mockQueryBuilder({ data: [] }))
    fetchEventsInRange.mockResolvedValue([])

    renderPage()

    await screen.findByText('Upcoming')
    expect(screen.getByText(/Nothing scheduled/)).toBeInTheDocument()
  })
})
