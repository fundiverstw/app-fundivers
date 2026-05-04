import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'

const useAuthMock = vi.fn()
const signOut = vi.fn()
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

const usePWAInstallMock = vi.fn()
vi.mock('../../hooks/usePWAInstall', () => ({
  usePWAInstall: () => usePWAInstallMock(),
}))

beforeEach(() => {
  useAuthMock.mockReset()
  signOut.mockReset()
  usePWAInstallMock.mockReset()
  usePWAInstallMock.mockReturnValue({ canInstall: false, install: vi.fn(), isIOSInstallable: false })
})

function routedRender(start = '/calendar') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route element={<AppShell />}>
          <Route path="/calendar" element={<div>CAL</div>} />
          <Route path="/bookings" element={<div>BOOK</div>} />
          <Route path="/payments" element={<div>PAY</div>} />
          <Route path="/profile" element={<div>PROF</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('AppShell', () => {
  it('prefers display_name when present', () => {
    useAuthMock.mockReturnValue({
      profile: { display_name: 'Ada', full_name: 'Ada Lovelace' },
      signOut,
    })
    routedRender()
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
  })

  it('falls back to full_name when display_name is absent', () => {
    useAuthMock.mockReturnValue({
      profile: { display_name: null, full_name: 'Grace Hopper' },
      signOut,
    })
    routedRender()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
  })

  it('renders outlet content for current route', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender('/bookings')
    expect(screen.getByText('BOOK')).toBeInTheDocument()
  })

  it('clicking Sign out calls signOut and navigates to /login', async () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    signOut.mockResolvedValue(undefined)
    const user = userEvent.setup()
    routedRender()
    await user.click(screen.getByRole('button', { name: /sign out/i }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(await screen.findByText('LOGIN')).toBeInTheDocument()
  })

  it('shows Install app button when canInstall is true', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    usePWAInstallMock.mockReturnValue({ canInstall: true, install: vi.fn(), isIOSInstallable: false })
    routedRender()
    expect(screen.getByRole('button', { name: /install app/i })).toBeInTheDocument()
  })

  it('shows Install app button on iOS Safari (no native prompt available)', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    usePWAInstallMock.mockReturnValue({ canInstall: false, install: vi.fn(), isIOSInstallable: true })
    routedRender()
    expect(screen.getByRole('button', { name: /install app/i })).toBeInTheDocument()
  })

  it('hides Install app button when neither canInstall nor isIOSInstallable', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender()
    expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument()
  })

  it('Install button on iOS opens the instructions modal instead of calling install()', async () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    const install = vi.fn()
    usePWAInstallMock.mockReturnValue({ canInstall: false, install, isIOSInstallable: true })
    const user = userEvent.setup()
    routedRender()
    await user.click(screen.getByRole('button', { name: /install app/i }))
    expect(install).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: /install fundivers on iphone/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /got it/i }))
    expect(screen.queryByRole('dialog', { name: /install fundivers on iphone/i })).not.toBeInTheDocument()
  })

  it('Install button calls install() directly when a native prompt is available', async () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    const install = vi.fn()
    usePWAInstallMock.mockReturnValue({ canInstall: true, install, isIOSInstallable: false })
    const user = userEvent.setup()
    routedRender()
    await user.click(screen.getByRole('button', { name: /install app/i }))
    expect(install).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: /install fundivers on iphone/i })).not.toBeInTheDocument()
  })

  it("renders the admin's name as a link to /admin (the view-toggle affordance)", () => {
    useAuthMock.mockReturnValue({
      profile: { display_name: 'Admin', full_name: 'Eric', role: 'admin' },
      signOut,
    })
    routedRender()
    const link = screen.getByRole('link', { name: 'Admin' })
    expect(link).toHaveAttribute('href', '/admin')
  })

  it("renders a diver's name as plain text, not a link", () => {
    useAuthMock.mockReturnValue({
      profile: { display_name: 'Alice', full_name: 'Alice', role: 'diver' },
      signOut,
    })
    routedRender()
    expect(screen.queryByRole('link', { name: 'Alice' })).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('renders bottom nav links and the logo home link', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender()
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: /calendar/i })).toHaveAttribute('href', '/calendar')
    expect(screen.getByRole('link', { name: /bookings/i })).toHaveAttribute('href', '/bookings')
    expect(screen.getByRole('link', { name: /payments/i })).toHaveAttribute('href', '/payments')
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile')
  })
})
