import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ScheduledTripsPage } from './ScheduledTripsPage'
import type { ScheduledTripItem, MyScheduledTripRegistration } from '../types/database'

const { fetchScheduledTrips, fetchMyScheduledTripRegistrations } = vi.hoisted(() => ({
  fetchScheduledTrips: vi.fn(),
  fetchMyScheduledTripRegistrations: vi.fn(),
}))
vi.mock('../lib/scheduled-trips', () => ({
  fetchScheduledTrips: (...a: unknown[]) => fetchScheduledTrips(...a),
  fetchMyScheduledTripRegistrations: (...a: unknown[]) => fetchMyScheduledTripRegistrations(...a),
}))

const trip = (over: Partial<ScheduledTripItem> = {}): ScheduledTripItem => ({
  id: 's1', title: 'Palau Liveaboard', destination: 'Palau', summary: null, description: null,
  start_date: '2026-09-01', end_date: '2026-09-07', price: 80000, currency: 'TWD',
  hero_image_url: null, highlights: [], addon_ids: [], room_type_ids: [],
  published_at: '2026-06-01T00:00:00Z', ...over,
})

const registration = (over: Partial<MyScheduledTripRegistration> = {}): MyScheduledTripRegistration => ({
  id: 'reg1', scheduled_trip_id: 's1', status: 'registered', created_at: '2026-06-10T00:00:00Z',
  estimated_cost: 82000, estimated_currency: 'TWD', trip_title: 'Palau Liveaboard',
  trip_destination: 'Palau', trip_start_date: '2026-09-01', trip_end_date: '2026-09-07', ...over,
})

beforeEach(() => {
  fetchScheduledTrips.mockReset()
  fetchMyScheduledTripRegistrations.mockReset()
  fetchScheduledTrips.mockResolvedValue([trip()])
  fetchMyScheduledTripRegistrations.mockResolvedValue([])
})

describe('ScheduledTripsPage', () => {
  it('renders a trip card with its from-price, linking to the detail page', async () => {
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)

    const link = await screen.findByRole('link', { name: /Palau Liveaboard/ })
    expect(link).toHaveAttribute('href', '/scheduled-trips/s1')
    expect(screen.getByText(/from 80,000 TWD/)).toBeInTheDocument()
    expect(screen.getByText('Tap to register')).toBeInTheDocument()
  })

  it('shows a registered badge when the diver has a live registration for the trip', async () => {
    fetchMyScheduledTripRegistrations.mockResolvedValue([registration()])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)

    expect(await screen.findByText(/You.re registered/)).toBeInTheDocument()
    expect(screen.getByText(/est\. 82,000 TWD/)).toBeInTheDocument()
  })

  it('does not badge a trip whose registration is cancelled', async () => {
    fetchMyScheduledTripRegistrations.mockResolvedValue([registration({ status: 'cancelled' })])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)

    await screen.findByRole('link', { name: /Palau Liveaboard/ })
    expect(screen.queryByText(/You.re registered/)).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing is scheduled', async () => {
    fetchScheduledTrips.mockResolvedValue([])
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)
    expect(await screen.findByText(/no trips scheduled/i)).toBeInTheDocument()
  })

  it('surfaces a load error', async () => {
    fetchScheduledTrips.mockRejectedValue(new Error('network down'))
    render(<MemoryRouter><ScheduledTripsPage /></MemoryRouter>)
    expect(await screen.findByText(/network down/)).toBeInTheDocument()
  })
})
