import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminLogisticsPage } from './AdminLogisticsPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, rpc, fetchEventsInRange, fetchUpcomingEventDays, useAuthMock } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc:  vi.fn(),
  fetchEventsInRange: vi.fn(),
  fetchUpcomingEventDays: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

vi.mock('../../lib/events', () => ({
  fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  fetchUpcomingEventDays: (...a: unknown[]) => fetchUpcomingEventDays(...a),
  formatEventSpan: () => 'Jun 18',
}))

vi.mock('../../components/admin/AdminNotes', () => ({ AdminNotes: () => null }))

const diveEvent = { id: 'e1', type: 'dive', title: 'Kenting fun dive', start_time: '2026-06-18T00:00:00Z', end_time: null }
const bookings = [
  { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'pending',
    details: { transportation: true,  gear: { rent: true, items: ['BCD'] } } },
  { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'pending',
    details: { transportation: false, gear: { rent: true, items: ['Wetsuit'] } } },
]
const profiles = [
  { id: 'u1', name: 'Ada', nickname: 'Ada', contact_id: '0900', gear_owned: [] },
  { id: 'u2', name: 'Bo',  nickname: 'Bo',  contact_id: '0901', gear_owned: [] },
]

beforeEach(() => {
  from.mockReset(); rpc.mockReset(); fetchEventsInRange.mockReset(); fetchUpcomingEventDays.mockReset()
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ profile: { id: 'admin-1', role: 'admin' } })
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

  it('offers a per-event car picker listing the day\'s available cars', async () => {
    const vehicleRows = [{ id: 'v1', name: 'Delica', passenger_seats: 7, active: true, created_at: '', created_by: null }]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'vehicles') return mockQueryBuilder({ data: vehicleRows })
      if (table === 'event_vehicles') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    const cars = await screen.findByRole('group', { name: /assigned cars/i })
    expect(within(cars).getByText(/No car assigned yet/i)).toBeInTheDocument()
    const picker = within(cars).getByLabelText('Assign a car')
    expect(within(picker).getByRole('option', { name: 'Delica (7)' })).toBeInTheDocument()
  })

  it('shows who still owes for the day — overall total plus a per-event list, covered divers flagged', async () => {
    const payBookings = [
      // Ada owes her full 3,200 (no payments); pays for herself.
      { id: 'b1', user_id: 'u1', payer_id: 'u1', event_id: 'e1', status: 'pending',
        details: { transportation: false, gear: { rent: false }, total: 3200 } },
      // Bo's 2,800 is covered by the lead (Ada); 1,000 paid → 1,800 still due.
      { id: 'b2', user_id: 'u2', payer_id: 'u1', event_id: 'e1', status: 'pending',
        details: { transportation: false, gear: { rent: false }, total: 2800 } },
    ]
    const payments = [{ id: 'p1', booking_id: 'b2', amount: 1000, status: 'paid' }]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: payBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'payments') return mockQueryBuilder({ data: payments })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    // Overall summary: both owe, 3,200 + 1,800 = 5,000 outstanding.
    const overall = screen.getByText(/^overall/i).closest('section')!
    expect(within(overall).getByText(/2 divers still owe/i)).toBeInTheDocument()
    expect(within(overall).getByText(/5,000 outstanding/i)).toBeInTheDocument()

    // Per-event "Payments due": each diver, their amount, and the lead on the
    // hook for the covered one.
    const due = screen.getByRole('group', { name: /payments due/i })
    expect(within(due).getByText(/Bo/)).toBeInTheDocument()
    expect(within(due).getByText(/3,200 due/)).toBeInTheDocument()
    expect(within(due).getByText(/1,800 due/)).toBeInTheDocument()
    expect(within(due).getByText(/paid by Ada/i)).toBeInTheDocument()
  })

  it('plans which vehicles carry the divers who need a ride', async () => {
    // One on-duty staff rides along; Ada needs a ride, Bo self-transports.
    const duties = [
      { id: 'd1', assignee_id: 's1', role: 'guide', event_id: 'e1', start_date: '2026-06-18', end_date: null },
    ]
    const withStaff = [...profiles, { id: 's1', name: 'Dana', nickname: 'Dana', contact_id: '0999', gear_owned: [] }]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: withStaff })
      if (table === 'duties') return mockQueryBuilder({ data: duties })
      if (table === 'vehicles') return mockQueryBuilder({ data: [
        { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 7, active: true, created_by: null },
      ] })
      // The Delica is assigned to the event — divers ride only in assigned cars.
      if (table === 'event_vehicles') return mockQueryBuilder({ data: [
        { id: 'ev1', vehicle_id: 'v1', event_id: 'e1' },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    // Ada rides + the on-duty staff rides too → one Delica covers both, named.
    const overall = screen.getByText(/^overall/i).closest('section')!
    expect(await within(overall).findByText(/Take 1 vehicle — 7 seats for 2 riders/i)).toBeInTheDocument()
    // The Delica carries Ada and Dana; nobody is ride-less. Dana also shows in
    // the board's on-duty staff line, so match may be non-unique.
    expect(within(overall).getByText(/Delica/)).toBeInTheDocument()
    expect(within(overall).getAllByText(/Dana/).length).toBeGreaterThan(0)
    expect(within(overall).getAllByText(/Ada/).length).toBeGreaterThan(0)
    expect(within(overall).queryByText(/No seat/i)).not.toBeInTheDocument()
  })

  it('seats a rider even when no staff are on duty, with no driver concept', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'vehicles') return mockQueryBuilder({ data: [
        { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 7, active: true, created_by: null },
      ] })
      if (table === 'event_vehicles') return mockQueryBuilder({ data: [
        { id: 'ev1', vehicle_id: 'v1', event_id: 'e1' },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    const overall = screen.getByText(/^overall/i).closest('section')!
    // Ada is seated in the Delica; there's no driver assignment / warning at all.
    expect(await within(overall).findByText(/Delica/)).toBeInTheDocument()
    expect(within(overall).getByText('Ada')).toBeInTheDocument()
    expect(within(overall).queryByText(/driver/i)).not.toBeInTheDocument()
    expect(within(overall).queryByText(/No seat/i)).not.toBeInTheDocument()
  })

  it('does not seat divers in a fleet car that is not assigned to their event', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      // The Delica is active but assigned to NO event → off-limits to riders.
      if (table === 'vehicles') return mockQueryBuilder({ data: [
        { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 7, active: true, created_by: null },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    const overall = screen.getByText(/^overall/i).closest('section')!
    // Ada needs a ride but no car is on her event, so she stays unseated and the
    // unassigned Delica is not used to carry her.
    expect(await within(overall).findByText(/No seat/i)).toBeInTheDocument()
    expect(within(overall).queryByText(/Delica/)).not.toBeInTheDocument()
  })

  it('prompts to add vehicles when riders need a ride but the fleet is empty', async () => {
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    const overall = screen.getByText(/^overall/i).closest('section')!
    expect(within(overall).getByText(/No vehicles in the fleet yet/i)).toBeInTheDocument()
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
      { id: 'd1', assignee_id: 's1', role: 'guide', event_id: 'e1', start_date: '2026-06-18', end_date: null },
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

    // Overall board names the on-duty staff and their role(s).
    const overall = screen.getByText(/^overall/i).closest('section')!
    const boardStaff = within(overall).getByText('On-duty staff').closest('div')!
    expect(within(boardStaff).getByText(/Dana/)).toBeInTheDocument()
    expect(within(boardStaff).getByText(/guide/)).toBeInTheDocument()

    // Per-event group lists the staff member with their role.
    const group = screen.getByRole('group', { name: /on-duty staff/i })
    expect(within(group).getByText(/Dana/)).toBeInTheDocument()
    expect(within(group).getByText(/guide/)).toBeInTheDocument()
  })

  it('links each diver gear card to their People profile for admins', async () => {
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    // Only the gear-card name is a link; the ride-plan mention of Ada is plain text.
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute('href', '/admin/users?diver=u1')
    expect(screen.getByRole('link', { name: 'Bo' })).toHaveAttribute('href', '/admin/users?diver=u2')
  })

  it('does not link diver cards for staff (People is admin-only)', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 's-1', role: 'staff' } })
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument()
  })

  it('links each event banner — title and Edit button — to its edit page for admins', async () => {
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    const href = '/admin/events/e1/edit'
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', href)
    expect(screen.getByRole('link', { name: 'Kenting fun dive' })).toHaveAttribute('href', href)
  })

  it('shows the event title as plain text (no edit link) for staff', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 's-1', role: 'staff' } })
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Kenting fun dive' })).not.toBeInTheDocument()
    expect(screen.getByText('Kenting fun dive')).toBeInTheDocument()
  })

  it('shows delicate rentals in a separate "Handle with care" inventory, out of the gear chips', async () => {
    const careBookings = [
      // Ada: rents a dive computer (gear) — care item, NOT a dive-bag chip.
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'pending',
        details: { transportation: true, gear: { rent: true, items: ['BCD', 'Dive computer'] }, add_ons: [] } },
      // Bo: rents a dive light (add-on) + an SMB (dive-bag add-on, ignored).
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'pending',
        details: { transportation: false, gear: { rent: false }, add_ons: ['light2', 'smb'] } },
    ]
    const addons = [
      { id: 'light2', display_title: 'Light Rental (2 Days)', admin_title: 'Light 2' },
      { id: 'smb',    display_title: 'SMB Rental',            admin_title: 'SMB' },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: careBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'addons') return mockQueryBuilder({ data: addons })
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

    // The full per-event Add-ons summary lists every add-on by catalog title —
    // including the SMB (a dive-bag add-on) and the rented light.
    const addonsGroup = await screen.findByRole('group', { name: /^add-ons$/i })
    expect(within(addonsGroup).getByText(/SMB Rental ×1/)).toBeInTheDocument()
    expect(within(addonsGroup).getByText(/Light Rental \(2 Days\) ×1/)).toBeInTheDocument()

    // …and the whole-day total now sits in the Overall summary too, beside
    // "Gear to pack" and "Handle with care".
    const overall = screen.getByText(/^overall/i).closest('section')!
    const overallAddons = within(overall).getByText(/^add-ons$/i).closest('div')!
    expect(within(overallAddons).getByText(/SMB Rental ×1/)).toBeInTheDocument()
    expect(within(overallAddons).getByText(/Light Rental \(2 Days\) ×1/)).toBeInTheDocument()
  })
})
