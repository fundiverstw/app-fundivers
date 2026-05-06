import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminNotificationsPage } from './AdminNotificationsPage'

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: () => getSession() } },
}))

const toastSuccess = vi.fn()
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn() }),
}))

beforeEach(() => {
  getSession.mockReset()
  toastSuccess.mockReset()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).fetch = vi.fn()
  vi.stubEnv('VITE_PUSH_WORKER_URL', 'https://push.test')
})

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminNotificationsPage />
    </MemoryRouter>
  )
}

describe('AdminNotificationsPage', () => {
  it('blocks submit when title or body is empty', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))
    expect(await screen.findByText('Title and body are required.')).toBeInTheDocument()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((globalThis as any).fetch).not.toHaveBeenCalled()
  })

  it('sends payload to /admin-broadcast and toasts on success — omits url when the link field is empty', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sent: 3, skipped: 1, webhook: true }),
    })
    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/Trip cancelled/), { target: { value: 'Heads up' } })
    fireEvent.change(screen.getByPlaceholderText(/everyone needs to know/), { target: { value: 'Body text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(toastSuccess.mock.calls[0][0]).toMatch(/Sent to 3 devices/)
    expect(toastSuccess.mock.calls[0][0]).toMatch(/1 skipped/)
    expect(toastSuccess.mock.calls[0][0]).toMatch(/webhook ok/)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (globalThis as any).fetch.mock.calls[0]
    expect(call[0]).toBe('https://push.test/admin-broadcast')
    expect(call[1].headers.authorization).toBe('Bearer tok')
    // url is intentionally omitted (not even set to '') when the optional
    // Link field is left blank, so the worker treats it as "no link".
    expect(JSON.parse(call[1].body)).toEqual({ title: 'Heads up', body: 'Body text' })
  })

  it('passes through the optional Link field as `url` when filled in', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sent: 1, skipped: 0, webhook: null }),
    })
    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/Trip cancelled/), { target: { value: 'Read this' } })
    fireEvent.change(screen.getByPlaceholderText(/everyone needs to know/), { target: { value: 'Important' } })
    fireEvent.change(screen.getByPlaceholderText(/records\/bookings/), { target: { value: '/records/dive-logs' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await waitFor(() => expect((globalThis as any).fetch).toHaveBeenCalled())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (globalThis as any).fetch.mock.calls[0]
    expect(JSON.parse(call[1].body)).toEqual({
      title: 'Read this', body: 'Important', url: '/records/dive-logs',
    })
  })

  it('trims whitespace-only links to "no link" — empty after trim drops the url field', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ sent: 0, skipped: 0, webhook: null }),
    })
    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/Trip cancelled/), { target: { value: 't' } })
    fireEvent.change(screen.getByPlaceholderText(/everyone needs to know/), { target: { value: 'b' } })
    fireEvent.change(screen.getByPlaceholderText(/records\/bookings/), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await waitFor(() => expect((globalThis as any).fetch).toHaveBeenCalled())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (globalThis as any).fetch.mock.calls[0]
    expect(JSON.parse(call[1].body)).not.toHaveProperty('url')
  })

  it('surfaces an error when the worker returns non-ok', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    })
    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/Trip cancelled/), { target: { value: 'x' } })
    fireEvent.change(screen.getByPlaceholderText(/everyone needs to know/), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))

    expect(await screen.findByText('forbidden')).toBeInTheDocument()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('errors when no session is available', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    renderPage()
    fireEvent.change(screen.getByPlaceholderText(/Trip cancelled/), { target: { value: 'x' } })
    fireEvent.change(screen.getByPlaceholderText(/everyone needs to know/), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }))

    expect(await screen.findByText('Not signed in.')).toBeInTheDocument()
  })
})
