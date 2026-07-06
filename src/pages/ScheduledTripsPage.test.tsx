import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ScheduledTripsPage } from './ScheduledTripsPage'
import type { ScheduledTripItem } from '../types/database'

const { fetchScheduledTrips } = vi.hoisted(() => ({ fetchScheduledTrips: vi.fn() }))
vi.mock('../lib/scheduled-trips', () => ({
  fetchScheduledTrips: (...a: unknown[]) => fetchScheduledTrips(...a),
}))

const trip = (over: Partial<ScheduledTripItem> = {}): ScheduledTripItem => ({
  id: 's1', title: 'Palau Liveaboard', destination: 'Palau', summary: null, description: null,
  start_date: '2026-09-01', end_date: '2026-09-07', price: 80000, currency: 'TWD',
  hero_image_url: null, highlights: [], published_at: '2026-06-01T00:00:00Z',
  event_id: null, event_kind: null, ...over,
})

beforeEach(() => { fetchScheduledTrips.mockReset() })

describe('ScheduledTripsPage', () => {
  it('links a trip with a linked event into registration', async () => {
    fetchScheduledTrips.mockResolvedValue([trip({ event_id: 'e1', event_kind: 'dive' })])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: /Palau Liveaboard/ })
    expect(link).toHaveAttribute('href', '/register/dive/e1')
    expect(screen.getByText('Tap to register')).toBeInTheDocument()
  })

  it('points an unlinked trip at Contact', async () => {
    fetchScheduledTrips.mockResolvedValue([trip({ event_id: null, event_kind: null })])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: /Palau Liveaboard/ })
    expect(link).toHaveAttribute('href', '/contact')
    expect(screen.getByText('Contact us to join')).toBeInTheDocument()
  })

  it('shows an empty state when nothing is scheduled', async () => {
    fetchScheduledTrips.mockResolvedValue([])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)
    expect(await screen.findByText(/no trips scheduled/i)).toBeInTheDocument()
  })
})
