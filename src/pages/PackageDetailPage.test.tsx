import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PackageDetailPage } from './PackageDetailPage'
import type { PackageBoardItem, PackageTierItem, MyPackageRegistration } from '../types/database'

const {
  fetchPackageBoardItem, fetchPackageTiers, fetchMyPackageRegistrations, cancelMyPackageRegistration,
} = vi.hoisted(() => ({
  fetchPackageBoardItem: vi.fn(),
  fetchPackageTiers: vi.fn(),
  fetchMyPackageRegistrations: vi.fn(),
  cancelMyPackageRegistration: vi.fn(),
}))

vi.mock('../lib/packages', () => ({
  fetchPackageBoardItem: (...a: unknown[]) => fetchPackageBoardItem(...a),
  fetchPackageTiers: (...a: unknown[]) => fetchPackageTiers(...a),
  fetchMyPackageRegistrations: (...a: unknown[]) => fetchMyPackageRegistrations(...a),
  cancelMyPackageRegistration: (...a: unknown[]) => cancelMyPackageRegistration(...a),
}))

// The register wizard has its own test; stub it here to keep the page focused.
vi.mock('../components/register/PackageRegisterForm', () => ({
  PackageRegisterForm: () => null,
}))

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const pkg: PackageBoardItem = {
  id: 'p1', title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia',
  summary: 'Eight days of world-class reefs.', description: null, currency: 'TWD',
  hero_image_url: null, highlights: ['Manta cleaning stations'], addon_ids: [], room_type_ids: [],
  min_price: 50000, tier_count: 2, published_at: '2026-06-01T00:00:00Z', trusted_partner_id: 's1',
  partner_name: 'Blue Manta Divers', partner_country: 'Indonesia', partner_location: 'Raja Ampat',
  partner_website: 'https://partner.example', partner_logo_url: null,
  partner_vouch_notes: 'We have dived with them for years.',
}

const tiers: PackageTierItem[] = [
  { id: 't1', package_id: 'p1', name: 'Package A', price: 50000, currency: 'TWD', sort_order: 0 },
  { id: 't2', package_id: 'p1', name: 'Package B', price: 70000, currency: 'TWD', sort_order: 1 },
]

function registration(over: Partial<MyPackageRegistration> = {}): MyPackageRegistration {
  return {
    id: 'reg1', package_id: 'p1', tier_id: 't1', status: 'registered',
    created_at: '2026-06-10T00:00:00Z', preferred_start: null, preferred_end: null,
    estimated_cost: 55000, estimated_currency: 'TWD', package_title: pkg.title,
    package_destination: pkg.destination, partner_name: pkg.partner_name, tier_name: 'Package A',
    ...over,
  }
}

beforeEach(() => {
  fetchPackageBoardItem.mockReset()
  fetchPackageTiers.mockReset()
  fetchMyPackageRegistrations.mockReset()
  cancelMyPackageRegistration.mockReset()
  fetchPackageBoardItem.mockResolvedValue(pkg)
  fetchPackageTiers.mockResolvedValue(tiers)
  fetchMyPackageRegistrations.mockResolvedValue([])
  cancelMyPackageRegistration.mockResolvedValue(undefined)
})

function renderAt(id = 'p1') {
  return render(
    <MemoryRouter initialEntries={[`/packages/${id}`]}>
      <Routes>
        <Route path="/packages/:id" element={<PackageDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PackageDetailPage', () => {
  it('renders the pitch, its price tiers and the vouched shop', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Raja Ampat Liveaboard' })).toBeInTheDocument()
    expect(screen.getByText('Manta cleaning stations')).toBeInTheDocument()
    expect(screen.getByText('Package A')).toBeInTheDocument()
    expect(screen.getByText('50,000 TWD')).toBeInTheDocument()
    expect(screen.getByText(/In cooperation with Blue Manta Divers/)).toBeInTheDocument()
  })

  it('offers a Register button when the package has tiers', async () => {
    renderAt()
    await screen.findByRole('heading', { name: 'Raja Ampat Liveaboard' })
    expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument()
  })

  it('disables registering when there are no tiers', async () => {
    fetchPackageTiers.mockResolvedValue([])
    renderAt()
    await screen.findByRole('heading', { name: 'Raja Ampat Liveaboard' })
    expect(screen.getByRole('button', { name: /No packages available/ })).toBeDisabled()
  })

  it('shows the live registration card and cancels it', async () => {
    const user = userEvent.setup()
    fetchMyPackageRegistrations
      .mockResolvedValueOnce([registration()]) // initial load
      .mockResolvedValueOnce([]) // refetch after cancel
    renderAt()

    expect(await screen.findByRole('heading', { name: 'You’re registered' })).toBeInTheDocument()
    expect(screen.getByText(/55,000 TWD/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel registration' }))
    await waitFor(() => expect(cancelMyPackageRegistration).toHaveBeenCalledWith('reg1'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register' })).toBeInTheDocument())
  })

  it('handles a package that is no longer on the board', async () => {
    fetchPackageBoardItem.mockResolvedValue(null)
    renderAt('gone')
    expect(await screen.findByText(/isn’t on the board anymore/)).toBeInTheDocument()
  })
})
