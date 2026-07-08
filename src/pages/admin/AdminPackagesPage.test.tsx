import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { AdminPackagesPage } from './AdminPackagesPage'
import type { TrustedPartnerRow, Package } from '../../types/database'

const {
  fetchPackages, fetchPackageTiers, savePackage, setPackageStatus, deletePackage,
} = vi.hoisted(() => ({
  fetchPackages: vi.fn(),
  fetchPackageTiers: vi.fn(),
  savePackage: vi.fn(),
  setPackageStatus: vi.fn(),
  deletePackage: vi.fn(),
}))

vi.mock('../../lib/package-admin', () => ({
  fetchPackages: (...a: unknown[]) => fetchPackages(...a),
  fetchPackageTiers: (...a: unknown[]) => fetchPackageTiers(...a),
  savePackage: (...a: unknown[]) => savePackage(...a),
  setPackageStatus: (...a: unknown[]) => setPackageStatus(...a),
  deletePackage: (...a: unknown[]) => deletePackage(...a),
}))

// The page counts new registrations on mount; the Registrations tab itself is
// covered in AdminRegistrationsTab.test.tsx, so stub it here.
vi.mock('../../lib/package-registrations', () => ({
  countNewRegistrations: vi.fn().mockResolvedValue(0),
}))
vi.mock('../../components/admin/AdminRegistrationsTab', () => ({
  AdminRegistrationsTab: () => <div>registrations tab</div>,
}))

const { fetchAllTrustedPartners } = vi.hoisted(() => ({ fetchAllTrustedPartners: vi.fn() }))
vi.mock('../../lib/trusted-partners', () => ({
  fetchAllTrustedPartners: (...a: unknown[]) => fetchAllTrustedPartners(...a),
}))

// The package form loads the add-on/room catalog straight from supabase.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => mockQueryBuilder({ data: [] }) },
}))

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const partner: TrustedPartnerRow = {
  id: 's1', created_at: '2026-06-01T00:00:00Z', name: 'Blue Manta Divers', country: 'Indonesia',
  location: 'Raja Ampat', website: null, contact_name: null, contact_email: null,
  vouch_notes: null, logo_url: null, default_kickback_rate: 0.05, active: true, created_by: null,
}
const pkg: Package = {
  id: 'p1', created_at: '2026-06-02T00:00:00Z', trusted_partner_id: 's1',
  title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia', summary: null, description: null,
  currency: 'TWD', hero_image_url: null, highlights: [], addon_ids: [], room_type_ids: [],
  kickback_rate: 0.05, status: 'draft', published_at: null, created_by: null,
}

beforeEach(() => {
  for (const m of [fetchAllTrustedPartners, fetchPackages, fetchPackageTiers, savePackage, setPackageStatus, deletePackage]) m.mockReset()
  fetchAllTrustedPartners.mockResolvedValue([partner])
  fetchPackages.mockResolvedValue([pkg])
  fetchPackageTiers.mockResolvedValue([])
  savePackage.mockResolvedValue(undefined)
  setPackageStatus.mockResolvedValue(undefined)
  deletePackage.mockResolvedValue(undefined)
})

function renderPage() {
  return render(<MemoryRouter><AdminPackagesPage /></MemoryRouter>)
}

describe('AdminPackagesPage', () => {
  it('lists packages by default with their destination, partner, kickback and status', async () => {
    renderPage()
    expect(await screen.findByText('Raja Ampat Liveaboard')).toBeInTheDocument()
    expect(screen.getByText(/Raja Ampat, Indonesia · Blue Manta Divers · 5\.0%/)).toBeInTheDocument()
    expect(screen.getByText('draft')).toBeInTheDocument()
  })

  it('switches to the Registrations tab', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('tab', { name: /Registrations/ }))
    expect(await screen.findByText('registrations tab')).toBeInTheDocument()
  })

  it('publishes a draft package', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(setPackageStatus).toHaveBeenCalledWith(pkg, 'published'))
  })

  it('opens the new-package form with a tier row and an add-tier control', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: /New package/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Tier 1 name')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Tier 1 price')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Add tier/ })).toBeInTheDocument()
  })

  it('creates a package with its catalog ids and at least one tier', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Raja Ampat Liveaboard')
    await user.click(screen.getByRole('button', { name: /New package/ }))

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title *'), 'Anilao Macro Week')
    await user.type(within(dialog).getByLabelText('Destination *'), 'Anilao, Philippines')
    await user.type(within(dialog).getByLabelText('Tier 1 name'), 'Package A')
    await user.type(within(dialog).getByLabelText('Tier 1 price'), '48000')
    await user.click(within(dialog).getByRole('button', { name: /Create package/ }))

    await waitFor(() => expect(savePackage).toHaveBeenCalled())
    const [values, tierDrafts, existing] = savePackage.mock.calls[0]
    expect(values).toMatchObject({
      trusted_partner_id: 's1', title: 'Anilao Macro Week',
      destination: 'Anilao, Philippines', kickback_rate: 0.05, status: 'draft',
      addon_ids: [], room_type_ids: [],
    })
    expect(tierDrafts.length).toBeGreaterThanOrEqual(1)
    expect(tierDrafts[0]).toMatchObject({ name: 'Package A', price: 48000 })
    expect(existing).toBeUndefined()
  })
})
