import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { AdminScheduledTripsPage } from './AdminScheduledTripsPage'
import type { ScheduledTrip } from '../../types/database'

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

// The page counts new registrations on mount; the Registrations tab itself is
// covered in AdminScheduledTripRegistrationsTab.test.tsx, so stub it here.
vi.mock('../../lib/scheduled-trip-registrations', () => ({
  countNewRegistrations: vi.fn().mockResolvedValue(0),
}))
vi.mock('../../components/admin/AdminScheduledTripRegistrationsTab', () => ({
  AdminScheduledTripRegistrationsTab: () => <div>registrations tab</div>,
}))

// The trip form loads the add-on/room catalog straight from supabase.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => mockQueryBuilder({ data: [] }) },
}))

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const trip: ScheduledTrip = {
  id: 's1', created_at: '2026-06-02T00:00:00Z', title: 'Palau Liveaboard', destination: 'Palau',
  summary: null, description: null, start_date: null, end_date: null, price: 80000, currency: 'TWD',
  hero_image_url: null, highlights: [], addon_ids: [], room_type_ids: [],
  status: 'draft', published_at: null, created_by: null,
}

beforeEach(() => {
  for (const m of [fetchAllScheduledTrips, saveScheduledTrip, setScheduledTripStatus, deleteScheduledTrip]) m.mockReset()
  fetchAllScheduledTrips.mockResolvedValue([trip])
  saveScheduledTrip.mockResolvedValue(undefined)
  setScheduledTripStatus.mockResolvedValue(undefined)
  deleteScheduledTrip.mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminScheduledTripsPage /></MemoryRouter>)
}

describe('AdminScheduledTripsPage', () => {
  it('lists trips by default with their destination and status', async () => {
    renderPage()
    expect(await screen.findByText('Palau Liveaboard')).toBeInTheDocument()
    expect(screen.getByText('Palau')).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('switches to the Registrations tab', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Palau Liveaboard')
    await user.click(screen.getByRole('tab', { name: /Registrations/ }))
    expect(await screen.findByText('registrations tab')).toBeInTheDocument()
  })

  it('publishes a draft trip', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Palau Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(setScheduledTripStatus).toHaveBeenCalledWith(trip, 'published'))
  })

  it('opens the new-trip form', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Palau Liveaboard')
    await user.click(screen.getByRole('button', { name: /New trip/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'New trip' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Title *')).toBeInTheDocument()
  })

  it('creates a trip carrying its catalog add-on/room ids', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Palau Liveaboard')
    await user.click(screen.getByRole('button', { name: /New trip/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title *'), 'Green Island Weekend')
    await user.type(within(dialog).getByLabelText('Destination *'), 'Green Island')
    await user.click(within(dialog).getByRole('button', { name: /Create trip/ }))

    await waitFor(() => expect(saveScheduledTrip).toHaveBeenCalled())
    const [values, existing] = saveScheduledTrip.mock.calls[0]
    expect(values).toMatchObject({
      title: 'Green Island Weekend', destination: 'Green Island',
      status: 'draft', addon_ids: [], room_type_ids: [],
    })
    expect(existing).toBeUndefined()
  })
})
