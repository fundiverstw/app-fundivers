import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ScheduledTripDetailPage } from './ScheduledTripDetailPage'
import type { ScheduledTripItem, MyScheduledTripRegistration } from '../types/database'

const {
  fetchScheduledTrip, fetchMyScheduledTripRegistrations,
  registerForScheduledTrip, cancelMyScheduledTripRegistration,
} = vi.hoisted(() => ({
  fetchScheduledTrip: vi.fn(),
  fetchMyScheduledTripRegistrations: vi.fn(),
  registerForScheduledTrip: vi.fn(),
  cancelMyScheduledTripRegistration: vi.fn(),
}))

vi.mock('../lib/scheduled-trips', () => ({
  fetchScheduledTrip: (...a: unknown[]) => fetchScheduledTrip(...a),
  fetchMyScheduledTripRegistrations: (...a: unknown[]) => fetchMyScheduledTripRegistrations(...a),
  registerForScheduledTrip: (...a: unknown[]) => registerForScheduledTrip(...a),
  cancelMyScheduledTripRegistration: (...a: unknown[]) => cancelMyScheduledTripRegistration(...a),
}))

// The register wizard has its own test; stub it here to keep the page focused.
vi.mock('../components/register/RegisterWizard', () => ({
  RegisterWizard: () => null,
}))

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const trip: ScheduledTripItem = {
  id: 's1', title: 'Palau Liveaboard', destination: 'Palau', summary: 'Seven days of walls and mantas.',
  description: 'A full boat week.', start_date: '2026-09-01', end_date: '2026-09-07',
  price: 80000, currency: 'TWD', hero_image_url: null, highlights: ['Blue Corner drift'],
  addon_ids: ['a1'], room_type_ids: ['r1'], published_at: '2026-06-01T00:00:00Z',
}

const registration = (over: Partial<MyScheduledTripRegistration> = {}): MyScheduledTripRegistration => ({
  id: 'reg1', scheduled_trip_id: 's1', status: 'registered', created_at: '2026-06-10T00:00:00Z',
  estimated_cost: 82000, estimated_currency: 'TWD', trip_title: 'Palau Liveaboard',
  trip_destination: 'Palau', trip_start_date: '2026-09-01', trip_end_date: '2026-09-07', ...over,
})

beforeEach(() => {
  fetchScheduledTrip.mockReset()
  fetchMyScheduledTripRegistrations.mockReset()
  registerForScheduledTrip.mockReset()
  cancelMyScheduledTripRegistration.mockReset()
  fetchScheduledTrip.mockResolvedValue(trip)
  fetchMyScheduledTripRegistrations.mockResolvedValue([])
  cancelMyScheduledTripRegistration.mockResolvedValue(undefined)
})

function renderAt(id = 's1') {
  return render(
    <MemoryRouter initialEntries={[`/scheduled-trips/${id}`]}>
      <Routes>
        <Route path="/scheduled-trips/:id" element={<ScheduledTripDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ScheduledTripDetailPage', () => {
  it('renders the trip pitch, its from-price and highlights', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Palau Liveaboard' })).toBeInTheDocument()
    expect(screen.getByText('Seven days of walls and mantas.')).toBeInTheDocument()
    expect(screen.getByText('from 80,000 TWD')).toBeInTheDocument()
    expect(screen.getByText('Blue Corner drift')).toBeInTheDocument()
  })

  it('offers a Register button when there is no live registration', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Palau Liveaboard' })
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /You.re registered/ })).not.toBeInTheDocument()
  })

  it('shows the live registration card and cancels it', async () => {
    const user = userEvent.setup()
    fetchMyScheduledTripRegistrations
      .mockResolvedValueOnce([registration()]) // initial load
      .mockResolvedValueOnce([]) // refetch after cancel
    renderAt()

    expect(await screen.findByRole('heading', { name: /You.re registered/ })).toBeInTheDocument()
    expect(screen.getByText(/82,000 TWD/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel registration' }))
    await waitFor(() => expect(cancelMyScheduledTripRegistration).toHaveBeenCalledWith('reg1'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument())
  })

  it('handles a trip that is no longer on the board', async () => {
    fetchScheduledTrip.mockResolvedValue(null)
    renderAt('gone')
    expect(await screen.findByText(/isn.t on the board anymore/)).toBeInTheDocument()
  })
})
