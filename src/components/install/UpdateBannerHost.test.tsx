import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
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
        <Route path="/a" element={<div>A</div>} />
        <Route path="/b" element={<div>B</div>} />
      </Routes>
    </MemoryRouter>,
  )
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
