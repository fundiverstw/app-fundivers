import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiverTermsConsent } from './DiverTermsConsent'
import * as terms from '../../lib/terms'
import type { Profile } from '../../types/database'

let role: 'admin' | 'staff' = 'admin'
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin1' }, profile: { id: 'admin1', role } }),
}))

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(), toastError: vi.fn(),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

// The shop is on terms v3 throughout.
vi.mock('../../lib/use-terms', () => ({
  useTerms: () => ({
    terms: { title: 'Terms', body: 'x', version: 3, updatedAt: '' },
    loading: false,
  }),
}))

const profile = (over: Partial<Profile>): Profile => ({
  id: 'u1', email: 'jane@example.com', name: 'Jane Diver', nickname: null, role: 'diver',
  agreed_to_terms_at: null, agreed_to_terms_version: null,
  ...over,
} as Profile)

beforeEach(() => {
  vi.restoreAllMocks()
  role = 'admin'
  toastSuccess.mockReset()
  toastError.mockReset()
  vi.spyOn(terms, 'fetchLatestTermsToken').mockResolvedValue(null)
})

describe('DiverTermsConsent', () => {
  it('shows a walk-in with no consent as never agreed, and offers a link', async () => {
    render(<DiverTermsConsent user={profile({})} />)

    expect(await screen.findByText(/never agreed/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /email an agree link/i })).toBeInTheDocument()
  })

  it('shows a current agreement and offers nothing', async () => {
    render(<DiverTermsConsent user={profile({
      agreed_to_terms_at: '2026-07-03T00:00:00Z', agreed_to_terms_version: 3,
    })} />)

    expect(await screen.findByText(/agreed to v3 on jul 3, 2026/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agree link/i })).not.toBeInTheDocument()
  })

  it('flags an agreement that predates the current version', async () => {
    render(<DiverTermsConsent user={profile({
      agreed_to_terms_at: '2026-01-05T00:00:00Z', agreed_to_terms_version: 1,
    })} />)

    expect(await screen.findByText(/agreed to v1 — current version is v3/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /agree link/i })).toBeInTheDocument()
  })

  it('reports an unused outstanding link, and re-sends rather than sends', async () => {
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString()
    vi.spyOn(terms, 'fetchLatestTermsToken').mockResolvedValue({
      token: 'tk', created_at: '2026-07-20T00:00:00Z', expires_at: soon,
      used_at: null, accepted_version: null,
    })
    render(<DiverTermsConsent user={profile({})} />)

    expect(await screen.findByText(/link sent jul 20, 2026 .* unused/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /re-send agree link/i })).toBeInTheDocument()
  })

  it('records that consent arrived through the emailed link', async () => {
    vi.spyOn(terms, 'fetchLatestTermsToken').mockResolvedValue({
      token: 'tk', created_at: '2026-07-20T00:00:00Z', expires_at: '2026-10-18T00:00:00Z',
      used_at: '2026-07-22T00:00:00Z', accepted_version: 3,
    })
    render(<DiverTermsConsent user={profile({
      agreed_to_terms_at: '2026-07-22T00:00:00Z', agreed_to_terms_version: 3,
    })} />)

    expect(await screen.findByText(/agreed via emailed link on jul 22, 2026/i)).toBeInTheDocument()
  })

  it('sends the request and refreshes the link line', async () => {
    const send = vi.spyOn(terms, 'sendTermsRequest').mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<DiverTermsConsent user={profile({})} />)

    await user.click(await screen.findByRole('button', { name: /email an agree link/i }))
    expect(send).toHaveBeenCalledWith('u1')
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('surfaces a send failure', async () => {
    vi.spyOn(terms, 'sendTermsRequest').mockRejectedValue(new Error('email is not configured'))
    const user = userEvent.setup()
    render(<DiverTermsConsent user={profile({})} />)

    await user.click(await screen.findByRole('button', { name: /email an agree link/i }))
    expect(toastError).toHaveBeenCalled()
  })

  it('cannot send to a profile with no email address', async () => {
    render(<DiverTermsConsent user={profile({ email: null })} />)

    const button = await screen.findByRole('button', { name: /email an agree link/i })
    expect(button).toBeDisabled()
  })

  // Only admins can mint links (the edge function is admin-gated), but staff
  // still need to see whether a diver has agreed.
  it('shows status to staff but no send button', async () => {
    role = 'staff'
    render(<DiverTermsConsent user={profile({})} />)

    expect(await screen.findByText(/never agreed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /agree link/i })).not.toBeInTheDocument()
  })
})
