import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from './DashboardPage'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))
// Bouncers do their own timers/pointer math; stub them here since this
// test is only about the bubble console overlay and role label.
vi.mock('../components/dashboard/EelBouncer', () => ({
  EelBouncer: () => null,
}))
vi.mock('../components/dashboard/FrogBouncer', () => ({
  FrogBouncer: () => null,
}))
vi.mock('../components/dashboard/NudibranchBouncer', () => ({
  NudibranchBouncer: () => null,
}))
// FeaturedEvents fetches on mount; it has its own test. Stub it here so these
// tests stay focused on the bubble overlay and welcome banner.
vi.mock('../components/dashboard/FeaturedEvents', () => ({
  FeaturedEvents: () => null,
}))

// happy-dom provides a Canvas stub but getContext returns null by default.
// We replace it with a minimal 2d-context stand-in so the effect can complete
// without throwing. The actual rAF loop is not inspected.
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  })
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    setTransform: vi.fn(),
    fillRect:     vi.fn(),
    beginPath:    vi.fn(),
    arc:          vi.fn(),
    fill:         vi.fn(),
    scale:        vi.fn(),
    fillStyle:    '',
  })) as unknown as HTMLCanvasElement['getContext']
  useAuthMock.mockReset()
})

function renderPage() {
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('DashboardPage', () => {
  it('renders the bubbles canvas', () => {
    useAuthMock.mockReturnValue({ user: null, profile: null })
    renderPage()
    expect(document.querySelector('canvas')).not.toBeNull()
  })

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
