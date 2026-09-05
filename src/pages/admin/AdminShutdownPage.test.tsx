import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminShutdownPage } from './AdminShutdownPage'
import { ToastProvider } from '../../components/Toast'
import { renderWithRouter, mockQueryBuilder } from '../../../tests/test-utils'

const { from, getSession, fetchEventsInRange } = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  fetchEventsInRange: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    auth: { getSession: (...a: unknown[]) => getSession(...a) },
  },
}))

vi.mock('../../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../../lib/events')>('../../lib/events')
  return { ...actual, fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a) }
})

interface Rows {
  lastBackup?: string | null
  bookings?: Array<Record<string, unknown>>
  payments?: Array<Record<string, unknown>>
  credits?: Array<Record<string, unknown>>
  diverCount?: number
}

// The page reads five tables through three different shapes (maybeSingle, a
// paged range, a head count), so the stub answers per table rather than
// pretending one builder fits all.
function setupTables({ lastBackup = new Date().toISOString(), bookings = [], payments = [], credits = [], diverCount = 0 }: Rows = {}) {
  from.mockImplementation((table: string) => {
    if (table === 'admin_audit_log') {
      return mockQueryBuilder({ data: lastBackup ? { created_at: lastBackup } : null })
    }
    if (table === 'profiles') {
      return { select: () => ({ eq: () => Promise.resolve({ data: null, count: diverCount, error: null }) }) }
    }
    const rows = table === 'bookings' ? bookings : table === 'payments' ? payments : credits
    return {
      select: () => ({
        order: () => ({ range: async () => ({ data: rows, error: null }) }),
      }),
    }
  })
}

function render() {
  return renderWithRouter(<ToastProvider><AdminShutdownPage /></ToastProvider>)
}

beforeEach(() => {
  localStorage.clear()
  from.mockReset()
  getSession.mockReset()
  fetchEventsInRange.mockReset()
  fetchEventsInRange.mockResolvedValue([])
  vi.stubEnv('VITE_PUSH_WORKER_URL', 'https://push.example.test')
})

describe('AdminShutdownPage', () => {
  it('clears a shop that has settled everything and just backed up', async () => {
    setupTables()
    render()
    expect(await screen.findByText(/nothing outstanding/i)).toBeInTheDocument()
  })

  it('counts what is unsettled, in the shop\'s own money, before anything is deleted', async () => {
    setupTables({
      bookings: [{ id: 'b1', status: 'confirmed', details: { total: 3000 } }],
      payments: [{ booking_id: 'b1', amount: 1000, status: 'paid' }],
      credits:  [{ amount: 1500, status: 'open' }],
      diverCount: 74,
    })
    fetchEventsInRange.mockResolvedValue([
      { id: 'e1', start_time: '2099-05-01T09:00:00Z' },
      { id: 'e2', start_time: '2099-06-01T09:00:00Z' },
    ])
    render()

    expect(await screen.findByText(/2 events are still on the calendar/i)).toBeInTheDocument()
    expect(screen.getByText(/2,000 is still owed to the shop/i)).toBeInTheDocument()
    // The obligation that outlives the database.
    expect(screen.getByText(/1,500 of diver credit is unspent/i)).toBeInTheDocument()
    expect(screen.getByText(/74 diver accounts go with the project/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing outstanding/i)).not.toBeInTheDocument()
  })

  it('presses for a fresh backup when the last one is old, or has never happened', async () => {
    setupTables({ lastBackup: null })
    const { unmount } = render()
    expect(await screen.findByText(/no backup has ever been taken/i)).toBeInTheDocument()
    unmount()

    setupTables({ lastBackup: new Date(Date.now() - 72 * 3600 * 1000).toISOString() })
    render()
    expect(await screen.findByText(/take a fresh one before deleting anything/i)).toBeInTheDocument()
  })

  it('remembers which switch-off steps have been ticked', async () => {
    setupTables()
    const user = userEvent.setup()
    const { unmount } = render()
    await screen.findByText(/nothing outstanding/i)

    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(8)
    await user.click(boxes[0])
    await user.click(boxes[4])
    // Closing a shop takes hours across several sittings; a checklist that
    // forgets is worse than no checklist.
    expect(JSON.parse(localStorage.getItem('fundive.shutdown.ticks')!))
      .toMatchObject({ domain: true, supabase: true })

    unmount()
    render()
    await screen.findByText(/nothing outstanding/i)
    const reloaded = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(reloaded[0].checked).toBe(true)
    expect(reloaded[4].checked).toBe(true)
    expect(reloaded[1].checked).toBe(false)
  })

  it('sends the farewell push, prefilled so nobody has to compose it', async () => {
    setupTables()
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ sent: 12, skipped: 1, webhook: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    render()
    await screen.findByText(/nothing outstanding/i)

    expect(screen.getByDisplayValue(/is closing$/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /send to every diver/i }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://push.example.test/admin-broadcast')
    expect(JSON.parse(init.body as string)).toMatchObject({ title: expect.stringMatching(/is closing/i) })
    expect(await screen.findByText(/sent to 12 devices/i)).toBeInTheDocument()
  })

  it('says the app cannot reach anyone when push was never configured', async () => {
    setupTables()
    vi.stubEnv('VITE_PUSH_WORKER_URL', '')
    render()
    await screen.findByText(/nothing outstanding/i)
    expect(screen.getByText(/no way to reach your divers/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send to every diver/i })).not.toBeInTheDocument()
  })

  it('points at the exports that outlive the project, and at the retention rules', async () => {
    setupTables()
    render()
    await screen.findByText(/nothing outstanding/i)
    expect(screen.getByRole('link', { name: /database backup/i })).toHaveAttribute('href', '/admin/backup')
    expect(screen.getByRole('link', { name: /bookkeeping/i })).toHaveAttribute('href', '/admin/accounting')
    expect(screen.getByText(/kept for years after a business closes/i)).toBeInTheDocument()
  })
})
