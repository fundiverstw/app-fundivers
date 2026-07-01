import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareEventButton } from './ShareEventButton'
import { ToastProvider } from './Toast'
import { siteConfig } from '../config/site'

// happy-dom rejects clipboard writes by default (no secure context).
// Stub the entire navigator.clipboard via stubGlobal so the component
// gets a controllable mock.
const writeText = vi.fn()
beforeAll(() => {
  vi.stubGlobal('navigator', new Proxy(globalThis.navigator, {
    get(target, prop, receiver) {
      if (prop === 'clipboard') return { writeText }
      return Reflect.get(target, prop, receiver)
    },
  }))
})
afterAll(() => { vi.unstubAllGlobals() })
beforeEach(() => { writeText.mockReset() })

describe('ShareEventButton', () => {
  it('copies the Wix URL and toasts on success', async () => {
    writeText.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ShareEventButton event={{ id: 'abc-123', type: 'dive' }} />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: /share link/i }))

    expect(writeText).toHaveBeenCalledWith(`${siteConfig.urls.site}/dives/abc-123`)
    await waitFor(() => {
      expect(screen.getByText(/copied to clipboard/i)).toBeInTheDocument()
    })
  })

  it('toasts an error when the clipboard write fails', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ShareEventButton event={{ id: 'xyz-789', type: 'course' }} />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: /share link/i }))

    await waitFor(() => {
      expect(screen.getByText(/could not copy link/i)).toBeInTheDocument()
    })
  })
})
