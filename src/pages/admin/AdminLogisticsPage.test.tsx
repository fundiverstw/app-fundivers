import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminLogisticsPage } from './AdminLogisticsPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, rpc, fetchEventsInRange } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc:  vi.fn(),
  fetchEventsInRange: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

vi.mock('../../lib/events', () => ({
  fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  formatEventSpan: () => 'Jun 18',
}))

vi.mock('../../components/admin/AdminNotes', () => ({ AdminNotes: () => null }))

const diveEvent = { id: 'e1', type: 'dive', title: 'Kenting fun dive', start_time: '2026-06-18T00:00:00Z', end_time: null }
const bookings = [
  { id: 'b1', user_id: 'u1', eo_dive_id: 'e1', eo_course_id: null, status: 'pending',
    details: { transportation: true,  gear: { rent: true, items: ['BCD'] } } },
  { id: 'b2', user_id: 'u2', eo_dive_id: 'e1', eo_course_id: null, status: 'pending',
    details: { transportation: false, gear: { rent: true, items: ['Wetsuit'] } } },
]
const profiles = [
  { id: 'u1', name: 'Ada', nickname: 'Ada', contact_id: '0900', gear_owned: [] },
  { id: 'u2', name: 'Bo',  nickname: 'Bo',  contact_id: '0901', gear_owned: [] },
]

beforeEach(() => {
  from.mockReset(); rpc.mockReset(); fetchEventsInRange.mockReset()
  rpc.mockResolvedValue({ error: null })
  fetchEventsInRange.mockResolvedValue([diveEvent])
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return mockQueryBuilder({ data: bookings })
    if (table === 'profiles') return mockQueryBuilder({ data: profiles })
    return mockQueryBuilder({ data: [] })
  })
})

function renderPage() {
  return render(<MemoryRouter><AdminLogisticsPage /></MemoryRouter>)
}

describe('AdminLogisticsPage', () => {
  it('shows the overall summary and a by-event breakdown for the day', async () => {
    renderPage()
    // Overall: 1 event · 2 divers, 1 needs a ride, gear chips.
    expect(await screen.findByText(/1 event · 2 divers/i)).toBeInTheDocument()
    expect(screen.getByText(/need a ride/i)).toBeInTheDocument()
    expect(screen.getByText('BCD ×1')).toBeInTheDocument()
    expect(screen.getByText('Wetsuit ×1')).toBeInTheDocument()
    // By-event: the dive title and the needs-ride diver.
    expect(screen.getByText('Kenting fun dive')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /needs ride/i })).toBeInTheDocument()
  })

  it('refetches for a different day when a day tab is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    const firstDay = fetchEventsInRange.mock.calls[0][0] as string

    await user.click(screen.getByRole('tab', { name: /tomorrow/i }))
    await waitFor(() => expect(fetchEventsInRange.mock.calls.length).toBeGreaterThan(1))
    const laterDay = fetchEventsInRange.mock.calls.at(-1)![0] as string
    expect(laterDay).not.toBe(firstDay)
    expect(laterDay > firstDay).toBe(true)
  })

  it('shows an empty state for a day with no events', async () => {
    fetchEventsInRange.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/no events scheduled/i)).toBeInTheDocument()
  })
})
