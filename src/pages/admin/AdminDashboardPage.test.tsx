import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminDashboardPage } from './AdminDashboardPage'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

function builder(result: Record<string, unknown>) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'gte', 'lt', 'eq', 'neq', 'in', 'is', 'not', 'order']) b[m] = () => b
  b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej)
  return b
}

const profiles = [
  { id: 'd1', role: 'diver', status: 'active', created_at: '2026-06-02T00:00:00+08:00', nationality: 'Taiwan', cert_level: 'AOW' },
  { id: 'd2', role: 'diver', status: 'active', created_at: '2026-05-02T00:00:00+08:00', nationality: 'Japan', cert_level: 'OW' },
  { id: 'a1', role: 'admin', status: 'active', created_at: '2026-06-01T00:00:00+08:00', nationality: null, cert_level: null },
]
const bookings = [
  { id: 'b1', user_id: 'd1', event_id: 'dive1', status: 'confirmed', created_at: '2026-06-09T00:00:00+08:00', details: { total: 1000 } },
]
const payments = [
  { user_id: 'd1', booking_id: 'b1', amount: 1000, status: 'paid', method: 'bank_transfer', created_at: '2026-06-10T00:00:00+08:00' },
]
const dives = [{ id: 'dive1', kind: 'dive', display_title: 'Long Dong', admin_title: null, capacity: 10, start_date: '2030-07-01' }]
const courses = [{ id: 'course1', kind: 'course', display_title: 'OW Course', admin_title: null, capacity: 6, course_days: ['2030-07-20'] }]

beforeEach(() => {
  from.mockReset()
  // Dives and courses are one `events` table now, queried by `kind`. The two
  // reads fire in order (dive first, then course) inside the page's Promise.all,
  // so hand back dives on the first events call and courses on the second.
  let eventsCall = 0
  from.mockImplementation((table: string) => {
    switch (table) {
      case 'payments': return builder({ data: payments, error: null })
      case 'bookings': return builder({ data: bookings, error: null })
      case 'profiles': return builder({ data: profiles, count: 3, error: null })
      case 'events': return builder({ data: eventsCall++ === 0 ? dives : courses, error: null })
      default: return builder({ data: [], error: null })
    }
  })
})

function renderPage() {
  return render(<MemoryRouter><AdminDashboardPage /></MemoryRouter>)
}

describe('AdminDashboardPage', () => {
  it('renders KPI cards from fetched data', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Business performance' })).toBeInTheDocument()

    const active = screen.getByText('Active divers').closest('div')!
    expect(within(active).getByText('2')).toBeInTheDocument()

    const pending = screen.getByText('Pending new user requests').closest('div')!
    expect(within(pending).getByText('3')).toBeInTheDocument()
  })

  it('lists upcoming events in the fill table', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Business performance' })
    await waitFor(() => expect(screen.getAllByText('Long Dong').length).toBeGreaterThanOrEqual(1))
    expect(screen.getByText('OW Course')).toBeInTheDocument()
  })

  it('surfaces a fetch error', async () => {
    from.mockImplementation((table: string) =>
      table === 'payments'
        ? builder({ data: null, error: { message: 'boom' } })
        : builder({ data: [], error: null }))
    renderPage()
    expect(await screen.findByText('boom')).toBeInTheDocument()
  })
})
