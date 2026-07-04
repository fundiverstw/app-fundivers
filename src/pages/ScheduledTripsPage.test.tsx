import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ScheduledTripsPage } from './ScheduledTripsPage'

const { fetchEventsInRange } = vi.hoisted(() => ({ fetchEventsInRange: vi.fn() }))
vi.mock('../lib/events', () => ({
  fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  formatEventSpan: () => 'Jun 18, 2026',
}))

const ev = (id: string, title: string, flags: { is_trip?: boolean; is_boat_dive?: boolean }) => ({
  id, type: 'dive', title,
  start_time: '2026-06-18T00:00:00Z', end_time: null,
  is_trip: !!flags.is_trip, is_boat_dive: !!flags.is_boat_dive,
})

beforeEach(() => { fetchEventsInRange.mockReset() })

describe('ScheduledTripsPage', () => {
  it('lists only events flagged is_trip, and links each into registration', async () => {
    fetchEventsInRange.mockResolvedValue([
      ev('t1', 'Palau Liveaboard', { is_trip: true }),
      // A boat dive is NOT a trip — must be excluded even though it's a boat dive.
      ev('b1', 'Longdong Boat Dive', { is_boat_dive: true, is_trip: false }),
      ev('l1', 'House Reef Dive', {}),
    ])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: /Palau Liveaboard/ })
    expect(link).toHaveAttribute('href', '/register/dive/t1')
    expect(screen.queryByText('Longdong Boat Dive')).not.toBeInTheDocument()
    expect(screen.queryByText('House Reef Dive')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing upcoming is flagged a trip', async () => {
    fetchEventsInRange.mockResolvedValue([ev('b1', 'Longdong Boat Dive', { is_boat_dive: true })])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)
    expect(await screen.findByText(/no trips scheduled/i)).toBeInTheDocument()
  })
})
