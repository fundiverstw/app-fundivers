import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminShopProfilePage } from './AdminShopProfilePage'
import { NO_SHOP_PROFILE, type ShopProfile } from '../../lib/shop-profile'
import { siteConfig } from '../../config/site'
import { t } from '../../i18n'

const sp = t.admin.shopProfile

const { fetchStandardsOrganizations, saveShopProfile, refresh, profileRef } = vi.hoisted(() => ({
  fetchStandardsOrganizations: vi.fn(),
  saveShopProfile: vi.fn(),
  refresh: vi.fn(),
  profileRef: { current: null as ShopProfile | null },
}))

vi.mock('../../lib/shop-profile', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/shop-profile')>()),
  fetchStandardsOrganizations: (...a: unknown[]) => fetchStandardsOrganizations(...a),
  saveShopProfile: (...a: unknown[]) => saveShopProfile(...a),
  logoUrlOf: () => 'https://cdn.test/logo.png',
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))
vi.mock('../../hooks/useShopProfile', () => ({
  useShopProfile: () => ({ profile: profileRef.current ?? NO_SHOP_PROFILE, loading: false, refresh }),
}))

function renderPage(profile: ShopProfile = NO_SHOP_PROFILE) {
  profileRef.current = profile
  return render(<MemoryRouter><AdminShopProfilePage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  profileRef.current = null
  fetchStandardsOrganizations.mockResolvedValue(['CMAS', 'NAUI', 'PADI', 'SSI'])
  saveShopProfile.mockResolvedValue(undefined)
})

describe('AdminShopProfilePage', () => {
  it('offers every agency the ladder knows', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByLabelText(sp.standardsOrg)).toBeInTheDocument())
    const options = [...screen.getByLabelText(sp.standardsOrg).querySelectorAll('option')].map(o => o.textContent)
    expect(options).toEqual(['CMAS', 'NAUI', 'PADI', 'SSI'])
  })

  // A blank field would read as "unset" when the build is in fact running a
  // value; the form has to show what is actually in force.
  it('shows the running config where the shop has chosen nothing', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByLabelText(sp.currency)).toHaveValue(siteConfig.locale.currency))
    expect(screen.getByLabelText(sp.language)).toHaveValue(siteConfig.locale.language)
    expect(screen.getByLabelText(sp.standardsOrg)).toHaveValue('PADI')
  })

  it('saves the four settings together', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(screen.getByLabelText(sp.standardsOrg)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText(sp.standardsOrg), 'SSI')
    await user.clear(screen.getByLabelText(sp.currency))
    await user.type(screen.getByLabelText(sp.currency), 'JPY')
    await user.click(screen.getByRole('button', { name: sp.save }))

    await waitFor(() => expect(saveShopProfile).toHaveBeenCalled())
    expect(saveShopProfile.mock.calls[0][0]).toMatchObject({ standardsOrg: 'SSI', currency: 'JPY' })
    expect(refresh).toHaveBeenCalled()
  })

  // The page's whole honesty: a compiled-in setting the admin changed has not
  // taken effect, and saying nothing would be a control that quietly lies.
  it('says a saved currency has not taken effect yet', async () => {
    renderPage({ ...NO_SHOP_PROFILE, currency: 'XXX' })
    await waitFor(() => expect(screen.getByText(sp.driftHeading)).toBeInTheDocument())
    expect(screen.getByText(sp.driftRow('currency', 'XXX', siteConfig.locale.currency))).toBeInTheDocument()
    expect(screen.getByText(sp.driftBody)).toBeInTheDocument()
  })

  it('says nothing about drift when the build already matches', async () => {
    renderPage({ ...NO_SHOP_PROFILE, currency: siteConfig.locale.currency })
    await waitFor(() => expect(screen.getByLabelText(sp.currency)).toBeInTheDocument())
    expect(screen.queryByText(sp.driftHeading)).not.toBeInTheDocument()
  })

  it('offers to remove the logo only once one has been uploaded', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(sp.logoDefault)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: sp.logoRemove })).not.toBeInTheDocument()

    renderPage({ ...NO_SHOP_PROFILE, logoPath: 'logo-1.png' })
    await waitFor(() => expect(screen.getAllByText(sp.logoUploaded).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('button', { name: sp.logoRemove }).length).toBeGreaterThan(0)
  })
})
