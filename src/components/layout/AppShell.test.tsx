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
          <Route path="/records" element={<div>REC</div>} />
          <Route path="/profile" element={<div>PROF</div>} />
          <Route path="/contact" element={<div>CON</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('AppShell', () => {
  it("shows the diver's name", () => {
    useAuthMock.mockReturnValue({
      profile: { name: 'Grace Hopper' },
      signOut,
    })
    routedRender()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
  })

  it('renders outlet content for current route', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender('/records')
    expect(screen.getByText('REC')).toBeInTheDocument()
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
      profile: { name: 'Eric', role: 'admin' },
      signOut,
    })
    routedRender()
    const link = screen.getByRole('link', { name: 'Eric' })
    expect(link).toHaveAttribute('href', '/admin')
  })

  it("renders a diver's name as plain text, not a link", () => {
    useAuthMock.mockReturnValue({
      profile: { name: 'Alice', role: 'diver' },
      signOut,
    })
    routedRender()
    expect(screen.queryByRole('link', { name: 'Alice' })).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('no longer carries the Trusted Partners / Packages / Scheduled Trips shortcuts', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender()
    expect(screen.queryByRole('link', { name: /trusted partners/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^packages$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /scheduled trips/i })).not.toBeInTheDocument()
  })

  it('keeps the notification bell in the header', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender()
    expect(screen.getByRole('link', { name: /notification/i })).toBeInTheDocument()
  })

  it('renders Sign out as a button that reads as one, not as bare text', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender()
    const button = screen.getByRole('button', { name: /sign out/i })
    expect(button.className).toContain('border')
    expect(button.className).toContain('rounded-lg')
  })

  // The update banner moved to UpdateBannerHost (mounted at App root so it
  // shows on every route, not just shelled ones). Behavior is covered by
  // UpdateBannerHost.test.tsx.

  it('renders bottom nav links and the logo home link', () => {
    useAuthMock.mockReturnValue({ profile: null, signOut })
    routedRender()
    expect(screen.getByRole('link', { name: /home/i })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: /calendar/i })).toHaveAttribute('href', '/calendar')
    expect(screen.getByRole('link', { name: /records/i })).toHaveAttribute('href', '/records')
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile')
    expect(screen.getByRole('link', { name: /contact/i })).toHaveAttribute('href', '/contact')
    // Bookings and Payments are no longer top-level bottom-nav items — they
    // live as sub-tabs inside Records now.
    expect(screen.queryByRole('link', { name: /^bookings$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^payments$/i })).not.toBeInTheDocument()
  })
})
