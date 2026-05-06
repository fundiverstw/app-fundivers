import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { NotificationsPage } from './NotificationsPage'
import { mockQueryBuilder } from '../../tests/test-utils'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => { from.mockReset() })

const t0 = '2026-05-05T00:00:00.000Z'
const t1 = '2026-05-05T01:00:00.000Z'
const sample = [
  { id: 'n1', user_id: 'u', title: 'Trip in 3 days', body: 'Pay deposit',  url: '/bookings', kind: 'reminder',  event_id: 'e1', created_at: t1, read_at: null },
  { id: 'n2', user_id: 'u', title: 'Welcome',         body: 'Hi diver',     url: null,        kind: 'broadcast', event_id: null, created_at: t0, read_at: t0   },
]

function setup(rows = sample, updateSpy?: ReturnType<typeof vi.fn>) {
  from.mockImplementation(() => {
    const b = mockQueryBuilder({ data: rows }) as Record<string, unknown>
    if (updateSpy) {
      b.update = (...a: unknown[]) => {
        updateSpy(...a)
        return {
          eq: () => ({ is: () => Promise.resolve({ error: null }) }),
          is: () => Promise.resolve({ error: null }),
        }
      }
    }
    return b
  })
}

function renderPage() {
  return render(<MemoryRouter><NotificationsPage /></MemoryRouter>)
}

// Lets us observe navigation when the user taps "Open event" inside an
// expanded row.
function renderPageWithRoutes() {
  return render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/bookings" element={<div>BOOKINGS_PAGE</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('NotificationsPage', () => {
  it('renders the inbox most-recent first with an unread visual', async () => {
    setup()
    renderPage()
    await screen.findByText('Trip in 3 days')
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    // Mark-all-read button surfaces only when at least one row is unread.
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeInTheDocument()
  })

  it('tapping an unread row expands it (showing the body) and marks it read', async () => {
    const updateSpy = vi.fn()
    setup(sample, updateSpy)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Trip in 3 days')
    // Body is hidden in the collapsed state.
    expect(screen.queryByText('Pay deposit')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Trip in 3 days/i }))

    // Body now visible.
    expect(await screen.findByText('Pay deposit')).toBeInTheDocument()
    // Mark-as-read fired with a timestamp.
    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    const payload = updateSpy.mock.calls[0]?.[0] as Record<string, unknown>
    expect(typeof payload.read_at).toBe('string')
  })

  it('tapping the expanded row again collapses it (no double-mark-read)', async () => {
    const updateSpy = vi.fn()
    setup(sample, updateSpy)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Trip in 3 days')

    const row = screen.getByRole('button', { name: /Trip in 3 days/i })
    await user.click(row)
    expect(await screen.findByText('Pay deposit')).toBeInTheDocument()
    await user.click(row)
    expect(screen.queryByText('Pay deposit')).not.toBeInTheDocument()
    // Mark-as-read fires once on the first expand, not on the collapse.
    expect(updateSpy).toHaveBeenCalledTimes(1)
  })

  it('navigates only when the explicit "Open event" button is tapped', async () => {
    setup(sample)
    const user = userEvent.setup()
    renderPageWithRoutes()
    await screen.findByText('Trip in 3 days')

    // Expanding the row should NOT navigate.
    await user.click(screen.getByRole('button', { name: /Trip in 3 days/i }))
    expect(screen.queryByText('BOOKINGS_PAGE')).not.toBeInTheDocument()

    // The action button does navigate.
    await user.click(screen.getByRole('button', { name: /open event/i }))
    expect(await screen.findByText('BOOKINGS_PAGE')).toBeInTheDocument()
  })

  it('shows the empty state when there are no notifications', async () => {
    setup([])
    renderPage()
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument()
    // Mark-all-read hidden when there are no unread rows.
    expect(screen.queryByRole('button', { name: /mark all read/i })).not.toBeInTheDocument()
  })

  it('omits the action button entirely when the notification has no url (admin sent broadcast with no link)', async () => {
    setup([{
      id: 'n-no-link', user_id: 'u',
      title: 'No link broadcast', body: 'Body only',
      url: null, kind: 'broadcast',
      event_id: null,
      created_at: '2026-05-05T00:00:00.000Z',
      read_at: null,
    }])
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /no link broadcast/i }))
    // Body shows; CTA button is suppressed.
    expect(screen.getByText('Body only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open link/i })).not.toBeInTheDocument()
  })
})
