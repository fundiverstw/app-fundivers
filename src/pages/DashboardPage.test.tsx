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
})
