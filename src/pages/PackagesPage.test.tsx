import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PackagesPage } from './PackagesPage'
import type { PackageBoardItem, MyPackageReferral } from '../types/database'

const { fetchPackageBoard, fetchMyPackageReferrals } = vi.hoisted(() => ({
  fetchPackageBoard: vi.fn(),
  fetchMyPackageReferrals: vi.fn(),
}))

vi.mock('../lib/packages', () => ({
  fetchPackageBoard: (...a: unknown[]) => fetchPackageBoard(...a),
  fetchMyPackageReferrals: (...a: unknown[]) => fetchMyPackageReferrals(...a),
}))

const pkg: PackageBoardItem = {
  id: 'p1', title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia',
  summary: null, description: null, start_date: '2026-09-01', end_date: '2026-09-08',
  price: 60000, currency: 'TWD', hero_image_url: null, highlights: [], booking_url: null,
  published_at: '2026-06-01T00:00:00Z', trusted_partner_id: 's1', partner_name: 'Blue Manta Divers',
  partner_country: 'Indonesia', partner_location: 'Raja Ampat', partner_website: null, partner_vouch_notes: null,
}

beforeEach(() => {
  fetchPackageBoard.mockReset()
  fetchMyPackageReferrals.mockReset()
  fetchPackageBoard.mockResolvedValue([pkg])
  fetchMyPackageReferrals.mockResolvedValue([])
})

function renderPage() {
  return render(<MemoryRouter><PackagesPage /></MemoryRouter>)
}

describe('PackagesPage', () => {
  it('lists published packages with the in-cooperation badge and price', async () => {
    renderPage()
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/In cooperation with Blue Manta Divers/)).toBeInTheDocument()
    expect(screen.getByText(/60,000 TWD/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Trusted Partners/ })).toHaveAttribute('href', '/trusted-partners')
  })

  it('shows the diver’s existing referral state on a package card', async () => {
    const ref: MyPackageReferral = {
      id: 'r1', package_id: 'p1', referral_code: 'FD-7K2MQ4', status: 'interested',
      created_at: '2026-06-10T00:00:00Z', package_title: 'Raja Ampat Liveaboard',
      package_destination: 'Raja Ampat, Indonesia', partner_name: 'Blue Manta Divers',
    }
    fetchMyPackageReferrals.mockResolvedValue([ref])
    renderPage()
    expect(await screen.findByText(/FD-7K2MQ4/)).toBeInTheDocument()
    expect(screen.getByText(/interested/i)).toBeInTheDocument()
  })

  it('shows an empty state when the board has no packages', async () => {
    fetchPackageBoard.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/No packages on the board/i)).toBeInTheDocument()
  })
})
