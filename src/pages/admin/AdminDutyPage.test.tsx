import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminDutyPage } from './AdminDutyPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, useAuthMock, fetchEventsInRange } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsInRange: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../../lib/events')>('../../lib/events')
  return {
    ...actual,
    fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  }
})
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
  fetchEventsInRange.mockReset()
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminDutyPage />
    </MemoryRouter>
  )
}

describe('AdminDutyPage', () => {
  it('shows the logged-in admin their own upcoming duties + flags unstaffed events', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'admin-1' } })

    // One duty for the current user, one for another admin, and one unstaffed event.
    const duties = [
      {
        id: 'd1', created_at: '', created_by: 'admin-1', assignee_id: 'admin-1',
        role: 'guide', start_date: '2099-01-10', end_date: null,
        event_id: 'dive-a', notes: null,
      },
      {
        id: 'd2', created_at: '', created_by: 'admin-1', assignee_id: 'admin-2',
        role: 'instructor', start_date: '2099-02-01', end_date: '2099-02-03',
        event_id: 'course-a', notes: 'Teaching OW batch',
      },
    ]
    const admins = [
      { id: 'admin-1', nickname: 'Ada', name: 'Ada Lovelace', role: 'admin' },
      { id: 'admin-2', nickname: 'Grace', name: 'Grace Hopper', role: 'admin' },
    ]
    const events = [
      { id: 'dive-a',   type: 'dive',   title: 'Kenting Dive',  start_time: '2099-01-10T09:00:00Z', end_time: null, fully_booked: false, price: null, deposit_amount: null, currency: 'TWD', featured: false },
      { id: 'course-a', type: 'course', title: 'OW Batch',      start_time: '2099-02-01T09:00:00Z', end_time: null, fully_booked: false, price: null, deposit_amount: null, currency: 'TWD', featured: false },
      { id: 'dive-b',   type: 'dive',   title: 'Orphan Dive',   start_time: '2099-03-05T09:00:00Z', end_time: null, fully_booked: false, price: null, deposit_amount: null, currency: 'TWD', featured: false },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'duties')   return mockQueryBuilder({ data: duties })
      if (table === 'profiles') return mockQueryBuilder({ data: admins })
      return mockQueryBuilder({ data: [] })
    })
    fetchEventsInRange.mockResolvedValue(events)

    renderPage()

    // Current user's duty appears under "Your upcoming duties" (and also in
    // the "all" section — so expect at least one).
    await screen.findByText('Your upcoming duties')
    expect(screen.getAllByText('Kenting Dive').length).toBeGreaterThan(0)

    // Unstaffed events section lists the orphan dive only (the other two are covered).
    expect(screen.getByText('Unstaffed events')).toBeInTheDocument()
    expect(screen.getByText('Orphan Dive')).toBeInTheDocument()

    // All-upcoming section still lists both duty rows.
    expect(screen.getByText('All upcoming duties')).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper (Grace)')).toBeInTheDocument()
    expect(screen.getByText(/Teaching OW batch/)).toBeInTheDocument()
  })

  it('does not render the "your duties" section when the user has none', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'admin-1' } })
    from.mockImplementation((table: string) => {
      if (table === 'duties')   return mockQueryBuilder({ data: [] })
      if (table === 'profiles') return mockQueryBuilder({ data: [{ id: 'admin-1', role: 'admin', nickname: 'Ada', name: 'Ada Lovelace' }] })
      return mockQueryBuilder({ data: [] })
    })
    fetchEventsInRange.mockResolvedValue([])

    renderPage()

    await screen.findByText('All upcoming duties')
    expect(screen.queryByText('Your upcoming duties')).not.toBeInTheDocument()
    expect(screen.getByText('No duties assigned.')).toBeInTheDocument()
  })
})
