import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from './DashboardPage'

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))
// SharkBouncer does its own timers/pointer math; stub it here since this
// test is only about the bubble console overlay and role label.
vi.mock('../components/dashboard/SharkBouncer', () => ({
  SharkBouncer: () => null,
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
  it('labels as admin console for admin users', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'admin' } })
    renderPage()
    expect(screen.getByText(/FUNDIVERS · TW/)).toBeInTheDocument()
    expect(screen.getByText('admin console')).toBeInTheDocument()
    expect(document.querySelector('canvas')).not.toBeNull()
  })

  it('labels as diver console for non-admin users', () => {
    useAuthMock.mockReturnValue({ profile: { role: 'diver' } })
    renderPage()
    expect(screen.getByText('diver console')).toBeInTheDocument()
  })
})
