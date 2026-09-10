import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminCertEquivalencePage } from './AdminCertEquivalencePage'
import { NO_SHOP_PROFILE, type CertEquivalenceRow } from '../../lib/shop-profile'
import { t } from '../../i18n'

const ce = t.admin.certEquivalence

const { fetchCertEquivalences, fetchStandardsOrganizations, profileRef } = vi.hoisted(() => ({
  fetchCertEquivalences: vi.fn(),
  fetchStandardsOrganizations: vi.fn(),
  profileRef: { current: { ...({} as Record<string, never>) } },
}))

vi.mock('../../lib/shop-profile', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/shop-profile')>()),
  fetchCertEquivalences: (...a: unknown[]) => fetchCertEquivalences(...a),
  fetchStandardsOrganizations: (...a: unknown[]) => fetchStandardsOrganizations(...a),
}))
vi.mock('../../hooks/useShopProfile', () => ({
  useShopProfile: () => ({
    profile: { ...NO_SHOP_PROFILE, standardsOrg: (profileRef.current as { org?: string }).org ?? null },
    loading: false,
    refresh: vi.fn(),
  }),
}))

const row = (over: Partial<CertEquivalenceRow>): CertEquivalenceRow => ({
  organization: 'PADI', rank: 1, code: 'open_water', name: 'OW',
  hub_code: 'open_water', hub_name: 'OW', equivalent_name: 'Open Water Diver', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  profileRef.current = {}
  fetchStandardsOrganizations.mockResolvedValue(['NAUI', 'PADI', 'SSI'])
  fetchCertEquivalences.mockResolvedValue([
    row({ organization: 'NAUI', rank: 2, code: 'naui_adv', name: 'Advanced Scuba Diver', hub_name: 'AOW', equivalent_name: 'Advanced Open Water Diver' }),
    row({ organization: 'PADI', rank: 6, code: 'msdt', name: 'MSDT', hub_name: 'MSDT', equivalent_name: null }),
  ])
})

describe('AdminCertEquivalencePage', () => {
  it('opens in the shop’s own agency', async () => {
    profileRef.current = { org: 'SSI' }
    render(<AdminCertEquivalencePage />)
    await waitFor(() => expect(fetchCertEquivalences).toHaveBeenCalledWith('SSI'))
  })

  it('falls back to the hub agency when the shop has not chosen', async () => {
    render(<AdminCertEquivalencePage />)
    await waitFor(() => expect(fetchCertEquivalences).toHaveBeenCalledWith('PADI'))
  })

  it('groups the ladders by agency and shows each rung’s equivalent', async () => {
    render(<AdminCertEquivalencePage />)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'NAUI' })).toBeInTheDocument())

    const naui = screen.getByRole('heading', { name: 'NAUI' }).closest('section')!
    expect(within(naui).getByText('Advanced Scuba Diver')).toBeInTheDocument()
    expect(within(naui).getByText('Advanced Open Water Diver')).toBeInTheDocument()
  })

  // A blank means the agency has no rung there, which is a fact about diving —
  // not a gap in the data, and it must not read as one.
  it('says "no equivalent" rather than leaving a rung blank', async () => {
    render(<AdminCertEquivalencePage />)
    await waitFor(() => expect(screen.getByText(ce.noEquivalent)).toBeInTheDocument())
    expect(screen.getByText(ce.noEquivalentHint)).toBeInTheDocument()
  })

  it('redraws the chart in another agency’s words', async () => {
    const user = userEvent.setup()
    render(<AdminCertEquivalencePage />)
    await waitFor(() => expect(screen.getByLabelText(ce.viewAs)).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText(ce.viewAs), 'NAUI')
    await waitFor(() => expect(fetchCertEquivalences).toHaveBeenCalledWith('NAUI'))
  })
})
