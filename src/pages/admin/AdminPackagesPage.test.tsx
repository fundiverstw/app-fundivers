import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminPackagesPage } from './AdminPackagesPage'
import type { TrustedPartnerRow, Package } from '../../types/database'

const {
  fetchPackages, savePackage, setPackageStatus, deletePackage,
} = vi.hoisted(() => ({
  fetchPackages: vi.fn(),
  savePackage: vi.fn(),
  setPackageStatus: vi.fn(),
  deletePackage: vi.fn(),
}))

vi.mock('../../lib/package-admin', () => ({
  fetchPackages: (...a: unknown[]) => fetchPackages(...a),
  savePackage: (...a: unknown[]) => savePackage(...a),
  setPackageStatus: (...a: unknown[]) => setPackageStatus(...a),
  deletePackage: (...a: unknown[]) => deletePackage(...a),
}))

// The hosting partners are loaded from the unified trusted-partner data layer.
const { fetchAllTrustedPartners } = vi.hoisted(() => ({ fetchAllTrustedPartners: vi.fn() }))
vi.mock('../../lib/trusted-partners', () => ({
  fetchAllTrustedPartners: (...a: unknown[]) => fetchAllTrustedPartners(...a),
}))

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

// The page loads a new-interest count on mount; the Referrals tab itself is
// covered in AdminReferralsTab.test.tsx.
vi.mock('../../lib/package-referrals', () => ({
  countInterestedReferrals: vi.fn().mockResolvedValue(0),
  fetchReferralsWithDivers: vi.fn().mockResolvedValue([]),
}))

const partner: TrustedPartnerRow = {
  id: 's1', created_at: '2026-06-01T00:00:00Z', name: 'Blue Manta Divers', country: 'Indonesia',
  location: 'Raja Ampat', website: null, contact_name: null, contact_email: null,
  vouch_notes: null, logo_url: null, default_kickback_rate: 0.05, active: true, created_by: null,
}
const pkg: Package = {
  id: 'p1', created_at: '2026-06-02T00:00:00Z', trusted_partner_id: 's1',
  title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia', summary: null, description: null,
  start_date: null, end_date: null, price: 60000, currency: 'TWD', hero_image_url: null,
  highlights: [], booking_url: null, kickback_rate: 0.05, status: 'draft', published_at: null, created_by: null,
}

beforeEach(() => {
  for (const m of [fetchAllTrustedPartners, fetchPackages, savePackage, setPackageStatus, deletePackage]) m.mockReset()
  fetchAllTrustedPartners.mockResolvedValue([partner])
  fetchPackages.mockResolvedValue([pkg])
  savePackage.mockResolvedValue(undefined)
  setPackageStatus.mockResolvedValue(undefined)
  deletePackage.mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminPackagesPage /></MemoryRouter>)
}

describe('AdminPackagesPage', () => {
  it('lists packages by default with their partner + status', async () => {
    renderPage()
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/Blue Manta Divers/)).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('publishes a draft package', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(setPackageStatus).toHaveBeenCalledWith(pkg, 'published'))
  })

  it('creates a package against the selected trusted partner, converting the kickback percent to a fraction', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: /New package/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title *'), 'Anilao Macro Week')
    await user.type(within(dialog).getByLabelText('Destination *'), 'Anilao, Philippines')
    await user.click(within(dialog).getByRole('button', { name: /Create package/ }))

    await waitFor(() => expect(savePackage).toHaveBeenCalled())
    const [values] = savePackage.mock.calls[0]
    expect(values).toMatchObject({
      trusted_partner_id: 's1', title: 'Anilao Macro Week',
      destination: 'Anilao, Philippines', kickback_rate: 0.05, status: 'draft',
    })
  })
})
