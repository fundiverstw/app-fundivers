import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignupPage } from './SignupPage'
import { renderWithRouter, byName } from '../../tests/test-utils'

const { signUp } = vi.hoisted(() => ({ signUp: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signUp } },
}))

beforeEach(() => { signUp.mockReset() })

describe('SignupPage', () => {
  it('rejects empty submit (email + password required)', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    // Empty email fails zod's `.email()` → "Invalid email"
    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('rejects too-short password (min 8)', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('email'), 'ada@example.com')
    await user.type(byName('password'), 'short')
    await user.type(byName('confirm'), 'short')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('rejects mismatched confirmation', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('email'), 'a@b.com')
    await user.type(byName('password'), 'goodpassword')
    await user.type(byName('confirm'), 'different1234')
    // Terms box has to be checked for zod to even reach the .refine() check
    // that compares password vs confirm.
    await user.click(byName('agreedToTerms'))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('rejects submit without the terms-of-use checkbox', async () => {
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('email'), 'ada@example.com')
    await user.type(byName('password'), 'secret1234')
    await user.type(byName('confirm'), 'secret1234')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/please agree to continue/i)).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('calls signUp and shows the confirmation screen on success', async () => {
    signUp.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('email'), 'ada@example.com')
    await user.type(byName('password'), 'secret1234')
    await user.type(byName('confirm'), 'secret1234')
    await user.click(byName('agreedToTerms'))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(signUp).toHaveBeenCalledOnce())
    const [arg] = signUp.mock.calls[0]
    expect(arg.email).toBe('ada@example.com')
    expect(arg.password).toBe('secret1234')
    expect(typeof arg.options?.data?.agreed_to_terms_at).toBe('string')
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })

  it('shows a server error without advancing to the success screen', async () => {
    signUp.mockResolvedValue({ error: { message: 'User already registered' } })
    const user = userEvent.setup()
    renderWithRouter(<SignupPage />)
    await user.type(byName('email'), 'taken@example.com')
    await user.type(byName('password'), 'secret1234')
    await user.type(byName('confirm'), 'secret1234')
    await user.click(byName('agreedToTerms'))
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/already registered/i)).toBeInTheDocument()
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument()
  })

  it('links to the login page', () => {
    renderWithRouter(<SignupPage />)
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login')
  })
})
