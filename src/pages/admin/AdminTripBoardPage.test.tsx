import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminTripBoardPage } from './AdminTripBoardPage'
import type { PartnerShop, Trip } from '../../types/database'

const {
  fetchPartnerShops, savePartnerShop, deletePartnerShop,
  fetchTrips, saveTrip, setTripStatus, deleteTrip,
} = vi.hoisted(() => ({
  fetchPartnerShops: vi.fn(),
  savePartnerShop: vi.fn(),
  deletePartnerShop: vi.fn(),
  fetchTrips: vi.fn(),
  saveTrip: vi.fn(),
  setTripStatus: vi.fn(),
  deleteTrip: vi.fn(),
}))

vi.mock('../../lib/trip-admin', () => ({
  fetchPartnerShops: (...a: unknown[]) => fetchPartnerShops(...a),
  savePartnerShop: (...a: unknown[]) => savePartnerShop(...a),
  deletePartnerShop: (...a: unknown[]) => deletePartnerShop(...a),
  fetchTrips: (...a: unknown[]) => fetchTrips(...a),
  saveTrip: (...a: unknown[]) => saveTrip(...a),
  setTripStatus: (...a: unknown[]) => setTripStatus(...a),
  deleteTrip: (...a: unknown[]) => deleteTrip(...a),
}))

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

// The page loads a new-interest count on mount; the Referrals tab itself is
// covered in AdminReferralsTab.test.tsx.
vi.mock('../../lib/trip-referrals', () => ({
  countInterestedReferrals: vi.fn().mockResolvedValue(0),
  fetchReferralsWithDivers: vi.fn().mockResolvedValue([]),
}))

const shop: PartnerShop = {
  id: 's1', created_at: '2026-06-01T00:00:00Z', name: 'Blue Manta Divers', country: 'Indonesia',
  location: 'Raja Ampat', website: null, contact_name: null, contact_email: null,
  vouch_notes: null, logo_url: null, default_kickback_rate: 0.05, active: true, created_by: null,
}
const trip: Trip = {
  id: 't1', created_at: '2026-06-02T00:00:00Z', partner_shop_id: 's1',
  title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia', summary: null, description: null,
  start_date: null, end_date: null, price: 60000, currency: 'TWD', hero_image_url: null,
  highlights: [], booking_url: null, kickback_rate: 0.05, status: 'draft', published_at: null, created_by: null,
}

beforeEach(() => {
  for (const m of [fetchPartnerShops, savePartnerShop, deletePartnerShop, fetchTrips, saveTrip, setTripStatus, deleteTrip]) m.mockReset()
  fetchPartnerShops.mockResolvedValue([shop])
  fetchTrips.mockResolvedValue([trip])
  savePartnerShop.mockResolvedValue(undefined)
  saveTrip.mockResolvedValue(undefined)
  setTripStatus.mockResolvedValue(undefined)
  deletePartnerShop.mockResolvedValue(undefined)
  deleteTrip.mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminTripBoardPage /></MemoryRouter>)
}

describe('AdminTripBoardPage', () => {
  it('lists trips by default with their partner + status', async () => {
    renderPage()
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/Blue Manta Divers/)).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('publishes a draft trip', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(setTripStatus).toHaveBeenCalledWith(trip, 'published'))
  })

  it('switches to the shops tab and lists partner shops', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('tab', { name: /Partner shops/ }))
    expect(await screen.findByText('Blue Manta Divers')).toBeInTheDocument()
    expect(screen.getByText(/5.0% default/)).toBeInTheDocument()
  })

  it('creates a partner shop through the modal', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('tab', { name: /Partner shops/ }))
    await user.click(await screen.findByRole('button', { name: /New partner shop/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Name *'), 'Sea Explorers')
    await user.type(within(dialog).getByLabelText('Country *'), 'Philippines')
    await user.click(within(dialog).getByRole('button', { name: /Create shop/ }))

    await waitFor(() => expect(savePartnerShop).toHaveBeenCalled())
    const [values] = savePartnerShop.mock.calls[0]
    expect(values).toMatchObject({ name: 'Sea Explorers', country: 'Philippines', default_kickback_rate: 0.05 })
  })

  it('creates a trip, converting the kickback percent to a fraction', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: /New trip/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title *'), 'Anilao Macro Week')
    await user.type(within(dialog).getByLabelText('Destination *'), 'Anilao, Philippines')
    await user.click(within(dialog).getByRole('button', { name: /Create trip/ }))

    await waitFor(() => expect(saveTrip).toHaveBeenCalled())
    const [values] = saveTrip.mock.calls[0]
    expect(values).toMatchObject({
      partner_shop_id: 's1', title: 'Anilao Macro Week',
      destination: 'Anilao, Philippines', kickback_rate: 0.05, status: 'draft',
    })
  })
})
