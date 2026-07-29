import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { UpdateBannerHost } from './UpdateBannerHost'

const usePWAUpdateMock = vi.fn()
vi.mock('../../hooks/usePWAUpdate', () => ({
  usePWAUpdate: () => usePWAUpdateMock(),
}))

beforeEach(() => {
  usePWAUpdateMock.mockReset()
})

// Drives a one-shot navigation to `to` when it's set, so a test can simulate
// the user moving between pages.
function Nav({ to }: { to: string | null }) {
  const navigate = useNavigate()
  useEffect(() => { if (to) navigate(to) }, [to, navigate])
  return null
}

function renderAt(navTo: string | null) {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <UpdateBannerHost />
      <Nav to={navTo} />
      <Routes>
        <Route path="/a" element={<form><input aria-label="field" /></form>} />
        <Route path="/b" element={<div>B</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const IDLE_MS = 15 * 60 * 1000

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('UpdateBannerHost', () => {
  it('renders nothing (no banner) even when an update is waiting', () => {
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update: vi.fn() })
    // Host alone — no sibling routes — so an empty container proves it renders
    // no UI of its own (the update is applied via reload, not a banner).
    const { container } = render(<MemoryRouter><UpdateBannerHost /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('does NOT apply the update while the user stays on the same page', () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
    renderAt(null) // no navigation
    expect(update).not.toHaveBeenCalled()
  })

  it('does NOT apply on navigation when no update is waiting', () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: false, update })
    act(() => { renderAt('/b') })
    expect(update).not.toHaveBeenCalled()
  })

  it('applies the update on the next navigation when one is waiting', () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
    act(() => { renderAt('/b') }) // arm on /a, then navigate to /b
    expect(update).toHaveBeenCalledOnce()
  })
})

// The diver who opens one page and never moves would otherwise sit on a stale
// build indefinitely — navigation alone is not enough of a trigger.
describe('UpdateBannerHost — the user who never navigates', () => {
  beforeEach(() => { setVisibility('visible') })

  it('applies the update once the tab goes hidden', () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
    renderAt(null)
    expect(update).not.toHaveBeenCalled()

    act(() => { setVisibility('hidden') })
    expect(update).toHaveBeenCalledOnce()
  })

  it('leaves a hidden tab alone when no update is waiting', () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: false, update })
    renderAt(null)
    act(() => { setVisibility('hidden') })
    expect(update).not.toHaveBeenCalled()
  })

  it('applies the update after a long stretch with no interaction', () => {
    vi.useFakeTimers()
    try {
      const update = vi.fn()
      usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
      renderAt(null)

      act(() => { vi.advanceTimersByTime(IDLE_MS - 1000) })
      expect(update).not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(2000) })
      expect(update).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps waiting while the user is still interacting', () => {
    vi.useFakeTimers()
    try {
      const update = vi.fn()
      usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
      renderAt(null)

      // A click every ten minutes keeps resetting the idle clock.
      for (let i = 0; i < 4; i++) {
        act(() => { vi.advanceTimersByTime(10 * 60 * 1000) })
        act(() => { window.dispatchEvent(new Event('pointerdown')) })
      }
      expect(update).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does NOT reload out from under someone who has typed into a form', () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
    renderAt(null)

    const field = screen.getByLabelText('field')
    act(() => { fireEvent.input(field, { target: { value: 'half a booking' } }) })
    act(() => { setVisibility('hidden') })

    expect(update).not.toHaveBeenCalled()
  })

  it('applies only once, however many triggers fire', () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
    renderAt(null)

    act(() => { setVisibility('hidden') })
    act(() => { setVisibility('visible') })
    act(() => { setVisibility('hidden') })

    expect(update).toHaveBeenCalledOnce()
  })
})
