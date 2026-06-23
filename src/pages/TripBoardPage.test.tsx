import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TripBoardPage } from './TripBoardPage'
import type { TripBoardItem, MyTripReferral } from '../types/database'

const { fetchTripBoard, fetchMyTripReferrals } = vi.hoisted(() => ({
  fetchTripBoard: vi.fn(),
  fetchMyTripReferrals: vi.fn(),
}))

vi.mock('../lib/trip-board', () => ({
  fetchTripBoard: (...a: unknown[]) => fetchTripBoard(...a),
  fetchMyTripReferrals: (...a: unknown[]) => fetchMyTripReferrals(...a),
}))

const trip: TripBoardItem = {
  id: 't1', title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia',
  summary: null, description: null, start_date: '2026-09-01', end_date: '2026-09-08',
  price: 60000, currency: 'TWD', hero_image_url: null, highlights: [], booking_url: null,
  published_at: '2026-06-01T00:00:00Z', partner_shop_id: 's1', partner_name: 'Blue Manta Divers',
  partner_country: 'Indonesia', partner_location: 'Raja Ampat', partner_website: null, partner_vouch_notes: null,
}

beforeEach(() => {
  fetchTripBoard.mockReset()
  fetchMyTripReferrals.mockReset()
  fetchTripBoard.mockResolvedValue([trip])
  fetchMyTripReferrals.mockResolvedValue([])
})

function renderPage() {
  return render(<MemoryRouter><TripBoardPage /></MemoryRouter>)
}

describe('TripBoardPage', () => {
  it('lists published trips with the vouched-by badge and price', async () => {
    renderPage()
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/Vouched by Blue Manta Divers/)).toBeInTheDocument()
    expect(screen.getByText(/60,000 TWD/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Partner Connect/ })).toHaveAttribute('href', '/partner-connect')
  })

  it('shows the diver’s existing referral state on a trip card', async () => {
    const ref: MyTripReferral = {
      id: 'r1', trip_id: 't1', referral_code: 'FD-7K2MQ4', status: 'interested',
      created_at: '2026-06-10T00:00:00Z', trip_title: 'Raja Ampat Liveaboard',
      trip_destination: 'Raja Ampat, Indonesia', partner_name: 'Blue Manta Divers',
    }
    fetchMyTripReferrals.mockResolvedValue([ref])
    renderPage()
    expect(await screen.findByText(/FD-7K2MQ4/)).toBeInTheDocument()
    expect(screen.getByText(/interested/i)).toBeInTheDocument()
  })

  it('shows an empty state when the board has no trips', async () => {
    fetchTripBoard.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/No trips on the board/i)).toBeInTheDocument()
  })
})
