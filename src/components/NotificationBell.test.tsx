import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NotificationBell } from './NotificationBell'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => { from.mockReset() })

// Bell's query is `.from('notifications').select('*', { count, head }).is('read_at', null)`.
// .is() resolves to `{ count, error }`. The shared mockQueryBuilder doesn't
// thread count through, so a tight per-test mock is simplest.
function setupCount(getCount: () => number) {
  from.mockImplementation(() => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.is = () => Promise.resolve({ count: getCount(), error: null })
    return b
  })
}

describe('NotificationBell', () => {
  it('renders no badge when there are no unread', async () => {
    setupCount(() => 0)
    render(<MemoryRouter><NotificationBell /></MemoryRouter>)
    const link = await screen.findByRole('link')
    expect(link.getAttribute('aria-label')).toMatch(/^Notifications$/i)
    expect(link.textContent).not.toMatch(/\d/)
  })

  it('renders the unread count when greater than zero', async () => {
    setupCount(() => 3)
    render(<MemoryRouter><NotificationBell /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
    expect(screen.getByRole('link').getAttribute('aria-label')).toMatch(/3 unread/i)
  })

  it('caps the badge at 99+ for large counts', async () => {
    setupCount(() => 742)
    render(<MemoryRouter><NotificationBell /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('99+')).toBeInTheDocument())
  })

  it('refetches on the notifications-changed window event', async () => {
    let next = 1
    setupCount(() => next)
    render(<MemoryRouter><NotificationBell /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())
    next = 5
    act(() => { window.dispatchEvent(new Event('notifications-changed')) })
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument())
  })
})
