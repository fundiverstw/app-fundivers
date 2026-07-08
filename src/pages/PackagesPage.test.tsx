import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { PackagesPage } from './PackagesPage'
import type { PackageBoardItem, MyPackageRegistration } from '../types/database'

const { fetchPackageBoard, fetchMyPackageRegistrations } = vi.hoisted(() => ({
  fetchPackageBoard: vi.fn(),
  fetchMyPackageRegistrations: vi.fn(),
}))

vi.mock('../lib/packages', () => ({
  fetchPackageBoard: (...a: unknown[]) => fetchPackageBoard(...a),
  fetchMyPackageRegistrations: (...a: unknown[]) => fetchMyPackageRegistrations(...a),
}))

const pkg: PackageBoardItem = {
  id: 'p1', title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia',
  summary: null, description: null, currency: 'TWD', hero_image_url: null, highlights: [],
  addon_ids: [], room_type_ids: [], min_price: 60000, tier_count: 2,
  published_at: '2026-06-01T00:00:00Z', trusted_partner_id: 's1', partner_name: 'Blue Manta Divers',
  partner_country: 'Indonesia', partner_location: 'Raja Ampat', partner_website: null,
  partner_logo_url: null, partner_vouch_notes: null,
}

function registration(over: Partial<MyPackageRegistration> = {}): MyPackageRegistration {
  return {
    id: 'reg1', package_id: 'p1', tier_id: 't1', status: 'registered',
    created_at: '2026-06-10T00:00:00Z', preferred_start: null, preferred_end: null,
    estimated_cost: 55000, estimated_currency: 'TWD', package_title: 'Raja Ampat Liveaboard',
    package_destination: 'Raja Ampat, Indonesia', partner_name: 'Blue Manta Divers', tier_name: 'Package A',
    ...over,
  }
}

beforeEach(() => {
  fetchPackageBoard.mockReset()
  fetchMyPackageRegistrations.mockReset()
  fetchPackageBoard.mockResolvedValue([pkg])
  fetchMyPackageRegistrations.mockResolvedValue([])
})

function renderPage() {
  return render(<MemoryRouter><PackagesPage /></MemoryRouter>)
}

describe('PackagesPage', () => {
  it('shows the loading state before the board resolves', () => {
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('lists published packages with the cooperation badge and a from-price', async () => {
    renderPage()
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/In cooperation with Blue Manta Divers/)).toBeInTheDocument()
    expect(screen.getByText(/from 60,000 TWD/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Trusted Partners/ })).toHaveAttribute('href', '/trusted-partners')
  })

  it('marks a card the diver has a live registration for', async () => {
    fetchMyPackageRegistrations.mockResolvedValue([registration()])
    renderPage()
    expect(await screen.findByText(/You’re registered/)).toBeInTheDocument()
    expect(screen.getByText(/est\. 55,000 TWD/)).toBeInTheDocument()
  })

  it('ignores a cancelled registration when badging a card', async () => {
    fetchMyPackageRegistrations.mockResolvedValue([registration({ status: 'cancelled' })])
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    expect(screen.queryByText(/You’re registered/)).not.toBeInTheDocument()
  })

  it('shows an empty state when the board has no packages', async () => {
    fetchPackageBoard.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/No packages on the board/i)).toBeInTheDocument()
  })

  it('surfaces a load error', async () => {
    fetchPackageBoard.mockRejectedValue(new Error('board is down'))
    renderPage()
    expect(await screen.findByText('board is down')).toBeInTheDocument()
  })
})
