import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { PackageDetailPage } from './PackageDetailPage'
import type { PackageBoardItem, MyPackageReferral } from '../types/database'

const { fetchPackageBoardItem, fetchMyPackageReferrals, expressPackageInterest } = vi.hoisted(() => ({
  fetchPackageBoardItem: vi.fn(),
  fetchMyPackageReferrals: vi.fn(),
  expressPackageInterest: vi.fn(),
}))

vi.mock('../lib/packages', () => ({
  fetchPackageBoardItem: (...a: unknown[]) => fetchPackageBoardItem(...a),
  fetchMyPackageReferrals: (...a: unknown[]) => fetchMyPackageReferrals(...a),
  expressPackageInterest: (...a: unknown[]) => expressPackageInterest(...a),
}))

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const pkg: PackageBoardItem = {
  id: 'p1', title: 'Raja Ampat Liveaboard', destination: 'Raja Ampat, Indonesia',
  summary: 'Eight days of world-class reefs.', description: 'Full liveaboard itinerary.',
  start_date: '2026-09-01', end_date: '2026-09-08', price: 60000, currency: 'TWD',
  hero_image_url: null, highlights: ['Manta cleaning stations', 'Macro heaven'], booking_url: 'https://partner.example/book',
  published_at: '2026-06-01T00:00:00Z', trusted_partner_id: 's1', partner_name: 'Blue Manta Divers',
  partner_country: 'Indonesia', partner_location: 'Raja Ampat', partner_website: 'https://partner.example',
  partner_vouch_notes: 'We have dived with them for years.',
}

beforeEach(() => {
  fetchPackageBoardItem.mockReset()
  fetchMyPackageReferrals.mockReset()
  expressPackageInterest.mockReset()
  fetchPackageBoardItem.mockResolvedValue(pkg)
  fetchMyPackageReferrals.mockResolvedValue([])
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
  it('renders the package pitch, highlights and the vouched shop', async () => {
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Raja Ampat Liveaboard' })).toBeInTheDocument()
    expect(screen.getByText('Manta cleaning stations')).toBeInTheDocument()
    expect(screen.getByText(/We have dived with them for years/)).toBeInTheDocument()
    expect(screen.getByText(/In cooperation with Blue Manta Divers/)).toBeInTheDocument()
  })

  it('expresses interest and surfaces the returned referral code', async () => {
    const user = userEvent.setup()
    expressPackageInterest.mockResolvedValue('FD-7K2MQ4')
    // After expressing interest the page refetches referrals.
    fetchMyPackageReferrals
      .mockResolvedValueOnce([]) // initial load: no referral
      .mockResolvedValueOnce([{  // post-interest refetch
        id: 'r1', package_id: 'p1', referral_code: 'FD-7K2MQ4', status: 'interested',
        created_at: '', package_title: pkg.title, package_destination: pkg.destination, partner_name: pkg.partner_name,
      } as MyPackageReferral])

    renderAt()
    await screen.findByRole('heading', { name: 'Raja Ampat Liveaboard' })
    await user.click(screen.getByRole('button', { name: /I’m interested/ }))

    await waitFor(() => expect(expressPackageInterest).toHaveBeenCalledWith('p1'))
    expect(await screen.findByText('FD-7K2MQ4')).toBeInTheDocument()
    expect(screen.getByText(/You’re on the list/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Book on the partner/ })).toHaveAttribute('href', 'https://partner.example/book')
  })

  it('shows the existing referral immediately when the diver already expressed interest', async () => {
    fetchMyPackageReferrals.mockResolvedValue([{
      id: 'r1', package_id: 'p1', referral_code: 'FD-ABCDEF', status: 'introduced',
      created_at: '', package_title: pkg.title, package_destination: pkg.destination, partner_name: pkg.partner_name,
    } as MyPackageReferral])
    renderAt()
    expect(await screen.findByText('FD-ABCDEF')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /I’m interested/ })).not.toBeInTheDocument()
  })

  it('handles a package that is no longer on the board', async () => {
    fetchPackageBoardItem.mockResolvedValue(null)
    renderAt('gone')
    expect(await screen.findByText(/isn’t on the board anymore/)).toBeInTheDocument()
  })
})
