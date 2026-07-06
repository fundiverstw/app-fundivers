import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TripDetailPage } from './TripDetailPage'
import type { TripBoardItem, MyTripReferral } from '../types/database'

const { fetchTripBoardItem, fetchMyTripReferrals, expressTripInterest } = vi.hoisted(() => ({
  fetchTripBoardItem: vi.fn(),
  fetchMyTripReferrals: vi.fn(),
  expressTripInterest: vi.fn(),
}))

vi.mock('../lib/trip-board', () => ({
  fetchTripBoardItem: (...a: unknown[]) => fetchTripBoardItem(...a),
  fetchMyTripReferrals: (...a: unknown[]) => fetchMyTripReferrals(...a),
  expressTripInterest: (...a: unknown[]) => expressTripInterest(...a),
}))

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const trip: TripBoardItem = {
  id: 't1', title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia',
  summary: 'Eight days of world-class reefs.', description: 'Full liveaboard itinerary.',
  start_date: '2026-09-01', end_date: '2026-09-08', price: 60000, currency: 'TWD',
  hero_image_url: null, highlights: ['Manta cleaning stations', 'Macro heaven'], booking_url: 'https://partner.example/book',
  published_at: '2026-06-01T00:00:00Z', partner_shop_id: 's1', partner_name: 'Blue Manta Divers',
  partner_country: 'Indonesia', partner_location: 'Raja Ampat', partner_website: 'https://partner.example',
  partner_vouch_notes: 'We have dived with them for years.',
}

beforeEach(() => {
  fetchTripBoardItem.mockReset()
  fetchMyTripReferrals.mockReset()
  expressTripInterest.mockReset()
  fetchTripBoardItem.mockResolvedValue(trip)
  fetchMyTripReferrals.mockResolvedValue([])
})

function renderAt(id = 't1') {
  return render(
    <MemoryRouter initialEntries={[`/trips/${id}`]}>
      <Routes>
        <Route path="/trips/:id" element={<TripDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('TripDetailPage', () => {
  it('renders the trip pitch, highlights and the vouched shop', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Raja Ampat Liveaboard' })).toBeInTheDocument()
    expect(screen.getByText('Manta cleaning stations')).toBeInTheDocument()
    expect(screen.getByText(/We have dived with them for years/)).toBeInTheDocument()
    expect(screen.getByText(/In cooperation with Blue Manta Divers/)).toBeInTheDocument()
  })

  it('expresses interest and surfaces the returned referral code', async () => {
    const user = userEvent.setup()
    expressTripInterest.mockResolvedValue('FD-7K2MQ4')
    // After expressing interest the page refetches referrals.
    fetchMyTripReferrals
      .mockResolvedValueOnce([]) // initial load: no referral
      .mockResolvedValueOnce([{  // post-interest refetch
        id: 'r1', trip_id: 't1', referral_code: 'FD-7K2MQ4', status: 'interested',
        created_at: '', trip_title: trip.title, trip_destination: trip.destination, partner_name: trip.partner_name,
      } as MyTripReferral])

    renderAt()
    await screen.findByRole('heading', { name: 'Raja Ampat Liveaboard' })
    await user.click(screen.getByRole('button', { name: /I’m interested/ }))

    await waitFor(() => expect(expressTripInterest).toHaveBeenCalledWith('t1'))
    expect(await screen.findByText('FD-7K2MQ4')).toBeInTheDocument()
    expect(screen.getByText(/You’re on the list/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Book on the partner/ })).toHaveAttribute('href', 'https://partner.example/book')
  })

  it('shows the existing referral immediately when the diver already expressed interest', async () => {
    fetchMyTripReferrals.mockResolvedValue([{
      id: 'r1', trip_id: 't1', referral_code: 'FD-ABCDEF', status: 'introduced',
      created_at: '', trip_title: trip.title, trip_destination: trip.destination, partner_name: trip.partner_name,
    } as MyTripReferral])
    renderAt()
    expect(await screen.findByText('FD-ABCDEF')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /I’m interested/ })).not.toBeInTheDocument()
  })

  it('handles a trip that is no longer on the board', async () => {
    fetchTripBoardItem.mockResolvedValue(null)
    renderAt('gone')
    expect(await screen.findByText(/isn’t on the board anymore/)).toBeInTheDocument()
  })
})
