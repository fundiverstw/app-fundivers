import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminScheduledTripsPage } from './AdminScheduledTripsPage'
import type { ScheduledTrip, AppEvent } from '../../types/database'

const {
  fetchAllScheduledTrips, saveScheduledTrip, setScheduledTripStatus, deleteScheduledTrip,
} = vi.hoisted(() => ({
  fetchAllScheduledTrips: vi.fn(),
  saveScheduledTrip: vi.fn(),
  setScheduledTripStatus: vi.fn(),
  deleteScheduledTrip: vi.fn(),
}))

vi.mock('../../lib/scheduled-trips-admin', () => ({
  fetchAllScheduledTrips: (...a: unknown[]) => fetchAllScheduledTrips(...a),
  saveScheduledTrip: (...a: unknown[]) => saveScheduledTrip(...a),
  setScheduledTripStatus: (...a: unknown[]) => setScheduledTripStatus(...a),
  deleteScheduledTrip: (...a: unknown[]) => deleteScheduledTrip(...a),
}))

const { fetchEventsInRange } = vi.hoisted(() => ({ fetchEventsInRange: vi.fn() }))
vi.mock('../../lib/events', () => ({
  fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  formatEventSpan: () => 'Sep 1, 2026',
}))
vi.mock('../../lib/logistics', () => ({ dayKeyOffset: () => '2027-01-01' }))

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const trip: ScheduledTrip = {
  id: 's1', created_at: '2026-06-01T00:00:00Z', title: 'Palau Liveaboard', destination: 'Palau',
  summary: null, description: null, start_date: '2026-09-01', end_date: '2026-09-07', price: 80000, currency: 'TWD',
  hero_image_url: null, highlights: [], status: 'draft', published_at: null, event_id: null, created_by: null,
}
const event = { id: 'e1', type: 'dive', title: 'Palau Boat Day', start_time: '2026-09-01T00:00:00Z', end_time: null, start_time_hhmm: null } as unknown as AppEvent

beforeEach(() => {
  for (const m of [fetchAllScheduledTrips, saveScheduledTrip, setScheduledTripStatus, deleteScheduledTrip]) m.mockReset()
  fetchAllScheduledTrips.mockResolvedValue([trip])
  fetchEventsInRange.mockResolvedValue([event])
  saveScheduledTrip.mockResolvedValue(undefined)
  setScheduledTripStatus.mockResolvedValue(undefined)
  deleteScheduledTrip.mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminScheduledTripsPage /></MemoryRouter>)
}

describe('AdminScheduledTripsPage', () => {
  it('lists scheduled trips with status and unlinked marker', async () => {
    renderPage()
    expect(await screen.findByText('Palau Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/not linked \(informational\)/)).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('publishes a draft trip', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Palau Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(setScheduledTripStatus).toHaveBeenCalledWith(trip, 'published'))
  })

  it('creates a trip linked to a catalog event', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Palau Liveaboard')
    await user.click(screen.getByRole('button', { name: /New trip/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title *'), 'Green Island Weekend')
    await user.type(within(dialog).getByLabelText('Destination *'), 'Green Island')
    await user.selectOptions(within(dialog).getByLabelText('Register via event'), 'e1')
    await user.click(within(dialog).getByRole('button', { name: /Create trip/ }))

    await waitFor(() => expect(saveScheduledTrip).toHaveBeenCalled())
    const [values] = saveScheduledTrip.mock.calls[0]
    expect(values).toMatchObject({
      title: 'Green Island Weekend', destination: 'Green Island', event_id: 'e1', status: 'draft',
    })
  })
})
