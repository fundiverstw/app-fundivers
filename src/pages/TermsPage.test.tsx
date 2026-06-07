import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TermsPage } from './TermsPage'
import { CURRENT_TERMS_VERSION } from '../lib/terms-version'

const useAuthMock = vi.fn()
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

const navigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigate,
}))

beforeEach(() => {
  useAuthMock.mockReset()
  rpc.mockReset()
  navigate.mockReset()
})

function renderAt(path = '/terms') {
  return render(<MemoryRouter initialEntries={[path]}><TermsPage /></MemoryRouter>)
}

describe('TermsPage re-acceptance banner', () => {
  it('hides the banner when the user is already at the current version', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: CURRENT_TERMS_VERSION },
      refreshProfile: vi.fn(),
    })
    renderAt('/terms?reaccept=1')
    expect(screen.queryByText(/Terms of Use have been updated/i)).not.toBeInTheDocument()
  })

  it('shows the banner when the version is stale', () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'u1', agreed_to_terms_version: 0 },
      refreshProfile: vi.fn(),
    })
    renderAt()
    expect(screen.getByText(/Terms of Use have been updated/i)).toBeInTheDocument()
  })

  it('refreshes the cached profile BEFORE navigating away, so the guard does not bounce back', async () => {
    const order: string[] = []
    const refreshProfile = vi.fn(async () => { order.push('refresh') })
    navigate.mockImplementation(() => { order.push('navigate') })
    rpc.mockResolvedValue({ error: null })
    useAuthMock.mockReturnValue({ profile: { id: 'u1', agreed_to_terms_version: 0 }, refreshProfile })

    renderAt()
    await userEvent.click(screen.getByRole('button', { name: /I agree to the updated Terms/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(rpc).toHaveBeenCalledWith('accept_current_terms', { p_version: CURRENT_TERMS_VERSION })
    expect(order).toEqual(['refresh', 'navigate'])
  })

  it('surfaces an error and does not navigate when the RPC fails', async () => {
    const refreshProfile = vi.fn()
    rpc.mockResolvedValue({ error: { message: 'nope' } })
    useAuthMock.mockReturnValue({ profile: { id: 'u1', agreed_to_terms_version: 0 }, refreshProfile })

    renderAt()
    await userEvent.click(screen.getByRole('button', { name: /I agree to the updated Terms/i }))

    expect(await screen.findByText('nope')).toBeInTheDocument()
    expect(refreshProfile).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
