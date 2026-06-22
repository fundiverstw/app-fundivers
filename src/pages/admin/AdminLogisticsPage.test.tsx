import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminLogisticsPage } from './AdminLogisticsPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, rpc, fetchEventsInRange, fetchUpcomingEventDays } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc:  vi.fn(),
  fetchEventsInRange: vi.fn(),
  fetchUpcomingEventDays: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

vi.mock('../../lib/events', () => ({
  fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  fetchUpcomingEventDays: (...a: unknown[]) => fetchUpcomingEventDays(...a),
  formatEventSpan: () => 'Jun 18',
}))

vi.mock('../../components/admin/AdminNotes', () => ({ AdminNotes: () => null }))

const diveEvent = { id: 'e1', type: 'dive', title: 'Kenting fun dive', start_time: '2026-06-18T00:00:00Z', end_time: null }
const bookings = [
  { id: 'b1', user_id: 'u1', eo_dive_id: 'e1', eo_course_id: null, status: 'pending',
    details: { transportation: true,  gear: { rent: true, items: ['BCD'] } } },
  { id: 'b2', user_id: 'u2', eo_dive_id: 'e1', eo_course_id: null, status: 'pending',
    details: { transportation: false, gear: { rent: true, items: ['Wetsuit'] } } },
]
const profiles = [
  { id: 'u1', name: 'Ada', nickname: 'Ada', contact_id: '0900', gear_owned: [] },
  { id: 'u2', name: 'Bo',  nickname: 'Bo',  contact_id: '0901', gear_owned: [] },
]

beforeEach(() => {
  from.mockReset(); rpc.mockReset(); fetchEventsInRange.mockReset(); fetchUpcomingEventDays.mockReset()
  rpc.mockResolvedValue({ error: null })
  fetchEventsInRange.mockResolvedValue([diveEvent])
  fetchUpcomingEventDays.mockResolvedValue([])
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return mockQueryBuilder({ data: bookings })
    if (table === 'profiles') return mockQueryBuilder({ data: profiles })
    return mockQueryBuilder({ data: [] })
  })
})

function renderPage() {
  return render(<MemoryRouter><AdminLogisticsPage /></MemoryRouter>)
}

describe('AdminLogisticsPage', () => {
  it('shows the overall summary and a by-event breakdown for the day', async () => {
    renderPage()
    // Overall: 1 event · 2 divers, 1 needs a ride, gear chips.
    expect(await screen.findByText(/1 event · 2 divers/i)).toBeInTheDocument()
    expect(screen.getByText(/need a ride/i)).toBeInTheDocument()
    expect(screen.getByText('BCD ×1')).toBeInTheDocument()
    expect(screen.getByText('Wetsuit ×1')).toBeInTheDocument()
    // By-event: the dive title and the needs-ride diver.
    expect(screen.getByText('Kenting fun dive')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /needs ride/i })).toBeInTheDocument()
  })

  it('refetches for a different day when a day tab is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    const firstDay = fetchEventsInRange.mock.calls[0][0] as string

    await user.click(screen.getByRole('tab', { name: /tomorrow/i }))
    await waitFor(() => expect(fetchEventsInRange.mock.calls.length).toBeGreaterThan(1))
    const laterDay = fetchEventsInRange.mock.calls.at(-1)![0] as string
    expect(laterDay).not.toBe(firstDay)
    expect(laterDay > firstDay).toBe(true)
  })

  it('shows an empty state for a day with no events', async () => {
    fetchEventsInRange.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/no events scheduled/i)).toBeInTheDocument()
  })

  it('lets you pick another day from the dropdown of upcoming event-days', async () => {
    fetchUpcomingEventDays.mockResolvedValue(['2026-07-10', '2026-07-15'])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    await user.click(screen.getByRole('tab', { name: /other day/i }))
    const select = await screen.findByRole('combobox', { name: /select a day/i })
    await user.selectOptions(select, '2026-07-15')

    await waitFor(() => {
      const last = fetchEventsInRange.mock.calls.at(-1)!
      expect(last[0]).toBe('2026-07-15')
      expect(last[1]).toBe('2026-07-15')
    })
  })

  it('counts on-duty staff distinctly in the summary and lists them per event', async () => {
    const duties = [
      { id: 'd1', assignee_id: 's1', role: 'guide', eo_dive_id: 'e1', eo_course_id: null, start_date: '2026-06-18', end_date: null },
    ]
    const withStaff = [...profiles, { id: 's1', name: 'Dana', nickname: 'Dana', contact_id: '0999', gear_owned: [] }]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: withStaff })
      if (table === 'duties') return mockQueryBuilder({ data: duties })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    // Summary: distinct staff count, separate from the divers' ride count.
    const summary = screen.getByText(/need a ride/i)
    expect(summary).toHaveTextContent(/1 on-duty staff/i)

    // Per-event group lists the staff member with their role.
    const group = screen.getByRole('group', { name: /on-duty staff/i })
    expect(within(group).getByText(/Dana/)).toBeInTheDocument()
    expect(within(group).getByText(/guide/)).toBeInTheDocument()
  })

  it('shows delicate rentals in a separate "Handle with care" inventory, out of the gear chips', async () => {
    const careBookings = [
      // Ada: rents a dive computer (gear) — care item, NOT a dive-bag chip.
      { id: 'b1', user_id: 'u1', eo_dive_id: 'e1', eo_course_id: null, status: 'pending',
        details: { transportation: true, gear: { rent: true, items: ['BCD', 'Dive computer'] }, add_ons: [] } },
      // Bo: rents a dive light (add-on) + an SMB (dive-bag add-on, ignored).
      { id: 'b2', user_id: 'u2', eo_dive_id: 'e1', eo_course_id: null, status: 'pending',
        details: { transportation: false, gear: { rent: false }, add_ons: ['light2', 'smb'] } },
    ]
    const addons = [
      { _id: 'light2', display_title: 'Light Rental (2 Days)', admin_title: 'Light 2' },
      { _id: 'smb',    display_title: 'SMB Rental',            admin_title: 'SMB' },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: careBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: addons })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    // The care section lists each delicate item with the renter's name.
    const care = await screen.findByRole('group', { name: /handle with care/i })
    expect(within(care).getByText(/Dive computer/)).toBeInTheDocument()
    expect(within(care).getByText(/Ada/)).toBeInTheDocument()
    expect(within(care).getByText(/Dive light/)).toBeInTheDocument()
    expect(within(care).getByText(/Bo/)).toBeInTheDocument()
    // SMB stays in the dive bags — never a care item.
    expect(within(care).queryByText(/SMB/)).not.toBeInTheDocument()

    // Dive computer is pulled OUT of the "Gear to pack" chips (BCD stays).
    const gearSection = screen.getByText(/gear to pack/i).closest('div')!
    expect(within(gearSection).getByText(/BCD ×1/)).toBeInTheDocument()
    expect(within(gearSection).queryByText(/Dive computer/)).not.toBeInTheDocument()
  })
})
