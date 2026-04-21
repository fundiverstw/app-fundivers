import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from './LoginPage'
import { renderWithRouter, byName } from '../../tests/test-utils'

const { signInWithPassword, navigate } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword } },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

beforeEach(() => {
  signInWithPassword.mockReset()
  navigate.mockReset()
})

describe('LoginPage', () => {
  it('shows validation errors for empty submit', async () => {
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('rejects too-short password', async () => {
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'a@b.com')
    await user.type(byName('password'), '12345')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/at least 6 characters/i)).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('calls signInWithPassword and navigates on success', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'ada@example.com')
    await user.type(byName('password'), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'ada@example.com',
        password: 'secret123',
      })
    )
    expect(navigate).toHaveBeenCalledWith('/calendar')
  })

  it('surfaces auth error and does not navigate', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid credentials' } })
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'ada@example.com')
    await user.type(byName('password'), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('dev-fill buttons populate diver and admin credentials (DEV mode only)', async () => {
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)

    const diverBtn = screen.getByRole('button', { name: /diver@diver\.diver/i })
    const adminBtn = screen.getByRole('button', { name: /admin@admin\.admin/i })
    expect(diverBtn).toBeInTheDocument()
    expect(adminBtn).toBeInTheDocument()

    await user.click(diverBtn)
    expect((byName('email') as HTMLInputElement).value).toBe('diver@diver.diver')
    expect((byName('password') as HTMLInputElement).value).toBe('diverdiver')

    await user.click(adminBtn)
    expect((byName('email') as HTMLInputElement).value).toBe('admin@admin.admin')
    expect((byName('password') as HTMLInputElement).value).toBe('adminadmin')
  })

  it('renders a link to the signup page', () => {
    renderWithRouter(<LoginPage />)
    expect(screen.getByRole('link', { name: /sign up/i })).toHaveAttribute('href', '/signup')
  })
})
