import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ShareEventButton } from './ShareEventButton'
import { ToastProvider } from './Toast'

// Drive the button off the share-url helper directly so these tests exercise
// the component's own branches (copy, error) independent of the configured app
// origin.
const { share } = vi.hoisted(() => ({ share: { url: 'https://app.shop.test/register/abc-123' } }))
vi.mock('../lib/event-share', () => ({ eventShareUrl: () => share.url }))

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
beforeEach(() => {
  writeText.mockReset()
  share.url = 'https://app.shop.test/register/abc-123'
})

describe('ShareEventButton', () => {
  it('copies the in-app event link and toasts on success', async () => {
    writeText.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ShareEventButton eventId="abc-123" />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: /share link/i }))

    expect(writeText).toHaveBeenCalledWith('https://app.shop.test/register/abc-123')
    await waitFor(() => {
      expect(screen.getByText(/copied to clipboard/i)).toBeInTheDocument()
    })
  })

  it('toasts an error when the clipboard write fails', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <ShareEventButton eventId="xyz-789" />
      </ToastProvider>
    )

    await user.click(screen.getByRole('button', { name: /share link/i }))

    await waitFor(() => {
      expect(screen.getByText(/could not copy link/i)).toBeInTheDocument()
    })
  })
})
