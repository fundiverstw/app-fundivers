import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from './DashboardPage'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))
// FeaturedEvents fetches on mount; it has its own test. Stub it here so these
// tests stay focused on the welcome banner.
vi.mock('../components/dashboard/FeaturedEvents', () => ({
  FeaturedEvents: () => null,
}))

beforeEach(() => {
  useAuthMock.mockReset()
})

function renderPage() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('DashboardPage', () => {
  it('shows the WelcomeBanner for a user welcomed within the last 24h', () => {
    useAuthMock.mockReturnValue({
      user: { user_metadata: { welcomed_at: new Date().toISOString() } },
      profile: null,
    })
    renderPage()
    expect(screen.getByText(/welcome to fundivers/i)).toBeInTheDocument()
  })

  it('hides the WelcomeBanner once 24h have passed since welcomed_at', () => {
    const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    useAuthMock.mockReturnValue({
      user: { user_metadata: { welcomed_at: longAgo } },
      profile: null,
    })
    renderPage()
    expect(screen.queryByText(/welcome to fundivers/i)).not.toBeInTheDocument()
  })

  it('hides the WelcomeBanner for a user who has never been welcomed', () => {
    useAuthMock.mockReturnValue({
      user: { user_metadata: {} },
      profile: null,
    })
    renderPage()
    expect(screen.queryByText(/welcome to fundivers/i)).not.toBeInTheDocument()
  })

  it('renders the quick links when asked, below the featured trips', () => {
    useAuthMock.mockReturnValue({ user: { user_metadata: {} }, profile: null })
    render(<MemoryRouter><DashboardPage quickLinks /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /trusted partners/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /almanac/i })).toBeInTheDocument()
  })

  // Staff-facing for now: the editor is one tap from writing a depth onto a
  // shared map, so the people doing it are the people who can also undo it.
  it('shows the dive-site maps to an admin and to nobody else', () => {
    for (const role of ['diver', 'staff']) {
      useAuthMock.mockReturnValue({ user: { user_metadata: {} }, profile: { role } })
      const { unmount } = render(<MemoryRouter><DashboardPage quickLinks /></MemoryRouter>)
      expect(screen.queryByText(/dive site maps/i)).not.toBeInTheDocument()
      unmount()
    }
    useAuthMock.mockReturnValue({ user: { user_metadata: {} }, profile: { role: 'admin' } })
    render(<MemoryRouter><DashboardPage quickLinks /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /dive site maps/i })).toHaveAttribute('href', '/site-maps')
  })

  it('omits them unless asked, so an embedder without room for them can opt out', () => {
    useAuthMock.mockReturnValue({ user: { user_metadata: {} }, profile: null })
    renderPage()
    expect(screen.queryByRole('link', { name: /trusted partners/i })).not.toBeInTheDocument()
  })
})
