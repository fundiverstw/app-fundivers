import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UpdateBannerHost } from './UpdateBannerHost'

const usePWAUpdateMock = vi.fn()
vi.mock('../../hooks/usePWAUpdate', () => ({
  usePWAUpdate: () => usePWAUpdateMock(),
}))

beforeEach(() => {
  usePWAUpdateMock.mockReset()
})

describe('UpdateBannerHost', () => {
  it('renders nothing when no SW update is waiting', () => {
    usePWAUpdateMock.mockReturnValue({ needRefresh: false, update: vi.fn() })
    const { container } = render(<UpdateBannerHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the banner when needRefresh=true', () => {
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update: vi.fn() })
    render(<UpdateBannerHost />)
    expect(screen.getByRole('alert')).toHaveTextContent(/new version is available/i)
  })

  it('clicking Update calls the update() helper', async () => {
    const update = vi.fn()
    usePWAUpdateMock.mockReturnValue({ needRefresh: true, update })
    const user = userEvent.setup()
    render(<UpdateBannerHost />)
    await user.click(screen.getByRole('button', { name: /^update$/i }))
    expect(update).toHaveBeenCalledOnce()
  })
})
