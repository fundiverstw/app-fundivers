import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from './LoginPage'
import { renderWithRouter, byName, mockQueryBuilder } from '../../tests/test-utils'

const { signInWithPassword, navigate, from } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  navigate: vi.fn(),
  from: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { signInWithPassword },
    from: (...a: unknown[]) => from(...a),
  },
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

beforeEach(() => {
  signInWithPassword.mockReset()
  navigate.mockReset()
  from.mockReset()
})

function okSignIn(
  role: 'diver' | 'admin' | 'staff' = 'diver',
  userId = 'u1',
  status: 'pending' | 'active' | 'rejected' = 'active',
) {
  signInWithPassword.mockResolvedValue({
    data: { user: { id: userId } },
    error: null,
  })
  from.mockReturnValue(mockQueryBuilder({ data: { role, status } }))
}

describe('LoginPage', () => {
  it('shows validation errors for empty submit', async () => {
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/invalid email/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('rejects too-short password', async () => {
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'a@b.com')
    await user.type(byName('password'), '12345')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument()
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('calls signInWithPassword and navigates a diver to /calendar', async () => {
    okSignIn('diver')
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
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/calendar'))
    expect(from).toHaveBeenCalledWith('profiles')
  })

  it('navigates an admin to /admin after sign-in', async () => {
    okSignIn('admin')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'admin@admin.admin')
    await user.type(byName('password'), 'adminadmin')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin'))
  })

  it('navigates a staff member to /admin/events after sign-in', async () => {
    okSignIn('staff')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'staff@staff.staff')
    await user.type(byName('password'), 'staffstaff')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin/events'))
  })

  it('routes a pending diver to /pending', async () => {
    okSignIn('diver', 'u1', 'pending')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'new@example.com')
    await user.type(byName('password'), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/pending'))
  })

  it('routes a rejected diver to /pending', async () => {
    okSignIn('diver', 'u1', 'rejected')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'rejected@example.com')
    await user.type(byName('password'), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/pending'))
  })

  it('lets a pending admin still hit /admin (status gate is diver-only)', async () => {
    okSignIn('admin', 'u1', 'pending')
    const user = userEvent.setup()
    renderWithRouter(<LoginPage />)
    await user.type(byName('email'), 'admin@example.com')
    await user.type(byName('password'), 'secret123')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/admin'))
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
