import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithRouter, byName } from '../../tests/test-utils'
import { ResetPasswordPage } from './ResetPasswordPage'

const { onAuthStateChange, getSession, updateUser, verifyOtp, authCallbackParams } = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  authCallbackParams: {
    code: null as string | null,
    tokenHash: null as string | null,
    type: null as string | null,
    error: null as string | null,
    errorCode: null,
    errorDescription: null,
  },
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
      getSession: (...a: unknown[]) => getSession(...a),
      updateUser: (...a: unknown[]) => updateUser(...a),
      verifyOtp: (...a: unknown[]) => verifyOtp(...a),
    },
  },
  authCallbackParams,
}))

let authCb: ((event: string, session: unknown) => void) | null = null

beforeEach(() => {
  onAuthStateChange.mockReset()
  getSession.mockReset()
  updateUser.mockReset()
  verifyOtp.mockReset()
  authCallbackParams.code = null
  authCallbackParams.tokenHash = null
  authCallbackParams.type = null
  authCallbackParams.error = null
  authCb = null

  onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
    authCb = cb
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  getSession.mockResolvedValue({ data: { session: null } })
  updateUser.mockResolvedValue({ error: null })
  verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'token expired' } })
})

describe('ResetPasswordPage', () => {
  it('shows an actionable error (not a silent hang) when the link is expired/consumed', async () => {
    authCallbackParams.error = 'access_denied'
    renderWithRouter(<ResetPasswordPage />)

    expect(await screen.findByText(/link expired/i)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: /request a new link/i })
    expect(cta).toHaveAttribute('href', '/forgot-password')
    // Never asks for a password on a dead link.
    expect(document.querySelector('input[type="password"]')).toBeNull()
  })

  it('unlocks the form on a PASSWORD_RECOVERY event and updates the password', async () => {
    authCallbackParams.code = 'pkce-code'
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    const user = userEvent.setup()
    renderWithRouter(<ResetPasswordPage />)

    // Recovery event arrives via the live listener.
    await waitFor(() => expect(authCb).toBeTruthy())
    authCb!('PASSWORD_RECOVERY', { user: { id: 'u1' } })

    await waitFor(() => expect(byName('password')).toBeInTheDocument())
    await user.type(byName('password'), 'newpass123')
    await user.type(byName('confirm'), 'newpass123')
    await user.click(screen.getByRole('button', { name: /set new password/i }))

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'newpass123' }))
  })

  it('still unlocks when the event fired before the listener attached (race) — code + session present', async () => {
    authCallbackParams.code = 'pkce-code'
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } })
    renderWithRouter(<ResetPasswordPage />)

    // No PASSWORD_RECOVERY event is delivered; the getSession fallback unlocks.
    await waitFor(() => expect(byName('password')).toBeInTheDocument())
  })

  it('shows the error when a recovery code is present but the exchange produced no session', async () => {
    authCallbackParams.code = 'pkce-code'
    getSession.mockResolvedValue({ data: { session: null } })
    renderWithRouter(<ResetPasswordPage />)

    expect(await screen.findByText(/link expired/i)).toBeInTheDocument()
  })

  it('verifies a token_hash recovery link via verifyOtp and unlocks the form', async () => {
    authCallbackParams.tokenHash = 'hash-abc'
    authCallbackParams.type = 'recovery'
    verifyOtp.mockResolvedValue({ data: { session: { user: { id: 'u1' } } }, error: null })
    renderWithRouter(<ResetPasswordPage />)

    await waitFor(() => expect(byName('password')).toBeInTheDocument())
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'hash-abc' })
    // The PKCE listener path is not used for token_hash links.
    expect(onAuthStateChange).not.toHaveBeenCalled()
  })

  it('shows the error when verifyOtp rejects a consumed/expired token_hash', async () => {
    authCallbackParams.tokenHash = 'hash-dead'
    authCallbackParams.type = 'recovery'
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'Token has expired or is invalid' } })
    renderWithRouter(<ResetPasswordPage />)

    expect(await screen.findByText(/link expired/i)).toBeInTheDocument()
  })
})
