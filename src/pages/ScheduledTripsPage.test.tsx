import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ScheduledTripsPage } from './ScheduledTripsPage'

// Only the events layer is mocked; diveIsTripOrBoat runs for real against the
// configured trip keywords ('kenting', 'boat', …), so the filter is exercised.
const { fetchEventsInRange } = vi.hoisted(() => ({ fetchEventsInRange: vi.fn() }))
vi.mock('../lib/events', () => ({
  fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  formatEventSpan: () => 'Jun 18, 2026',
}))

const ev = (id: string, title: string) => ({
  id, type: 'dive', title,
  start_time: '2026-06-18T00:00:00Z', end_time: null, dive_outing: null,
})

beforeEach(() => { fetchEventsInRange.mockReset() })

describe('ScheduledTripsPage', () => {
  it('lists only trip events and links each into registration', async () => {
    fetchEventsInRange.mockResolvedValue([ev('t1', 'Kenting Boat Trip'), ev('l1', 'House Reef Dive')])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: /Kenting Boat Trip/ })
    expect(link).toHaveAttribute('href', '/register/dive/t1')
    // A non-trip local dive is filtered out.
    expect(screen.queryByText('House Reef Dive')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing upcoming is a trip', async () => {
    fetchEventsInRange.mockResolvedValue([ev('l1', 'House Reef Dive')])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)
    expect(await screen.findByText(/no trips scheduled/i)).toBeInTheDocument()
  })
})
