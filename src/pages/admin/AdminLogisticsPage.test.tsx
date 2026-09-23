import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AdminLogisticsPage } from './AdminLogisticsPage'
import { mockQueryBuilder } from '../../../tests/test-utils'
import { siteConfig } from '../../config/site'
import { dayKeyOffset } from '../../lib/logistics'
import { OfflineContext, type OfflineContextValue } from '../../hooks/offline-context'
import { EMPTY_DAY_BOARD, type DayBoardData } from '../../lib/day-board'
import { SNAPSHOT_VERSION, type OfflineSnapshot } from '../../lib/offline-snapshot'
import { t } from '../../i18n'

// Mirror the page's own day maths (shop timezone, not the runner's) so the
// jump-button tests line up with the tabs it drives.
const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone })
const tomorrowKey = dayKeyOffset(todayKey, 1)

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

const diveEvent = { id: 'e1', type: 'dive', title: 'Kenting fun dive', has_transport: true, start_time: '2026-06-18T00:00:00Z', end_time: null }
const bookings = [
  { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'pending',
    details: { transportation: true,  gear: { rent: true, items: ['BCD'] } } },
  { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'pending',
    details: { transportation: false, gear: { rent: true, items: ['Wetsuit'] } } },
]
const profiles = [
  { id: 'u1', name: 'Ada', contact_id: '0900', gear_owned: [] },
  { id: 'u2', name: 'Bo',  contact_id: '0901', gear_owned: [] },
]

beforeEach(() => {
  // The packed-gear tick list lives in localStorage, so it would leak across tests.
  localStorage.clear()
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

  it('lists a dry event\'s registrants as non-divers, apart from the divers', async () => {
    // An EFR class and a fun dive on the same day: Ada dives, Cy does not, and
    // Bo does both — which makes Bo a diver, counted once.
    const dryEvent = { id: 'e2', type: 'course', title: 'EFR refresher', has_transport: false, enters_water: false, start_time: '2026-06-18T00:00:00Z', end_time: null }
    fetchEventsInRange.mockResolvedValue([diveEvent, dryEvent])
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: [
        { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: {} },
        { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: {} },
        { id: 'b3', user_id: 'u2', event_id: 'e2', status: 'confirmed', details: {} },
        { id: 'b4', user_id: 'u3', event_id: 'e2', status: 'confirmed', details: {} },
      ] })
      if (table === 'profiles') return mockQueryBuilder({ data: [
        ...profiles,
        { id: 'u3', name: 'Cy', contact_id: '0902', gear_owned: [] },
      ] })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    expect(within(overall).getByText(/2 events · 2 divers/i)).toBeInTheDocument()
    expect(within(overall).getByText(/1 non-diver/i)).toBeInTheDocument()

    const divers = within(overall).getByText(t.admin.logistics.diversOnDay).closest('div')!
    expect(within(divers).getByText('Ada')).toBeInTheDocument()
    expect(within(divers).getByText('Bo')).toBeInTheDocument()
    expect(within(divers).queryByText('Cy')).not.toBeInTheDocument()

    const nonDivers = within(overall).getByText(t.admin.logistics.nonDiversOnDay).closest('div')!
    expect(within(nonDivers).getByText('Cy')).toBeInTheDocument()
    expect(within(nonDivers).queryByText('Bo')).not.toBeInTheDocument()

    // And the dry event's own banner says so rather than counting divers.
    expect(screen.getByText(t.admin.logistics.dryEventBadge)).toBeInTheDocument()
  })

  it('opens a sized gear chip into the sizes the day needs, and closes it again', async () => {
    const user = userEvent.setup()
    const sizedBookings = [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed',
        details: { gear: { rent: true, items: ['BCD', 'Regulator'] } } },
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed',
        details: { gear: { rent: true, items: ['BCD'] } } },
    ]
    const sizedProfiles = [
      { ...profiles[0], bcd_size: 'M' },
      { ...profiles[1], bcd_size: 'L' },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: sizedBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: sizedProfiles })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    const gearSection = within(overall).getByText(/gear to pack/i).closest('div')!

    // Sizes are behind the chip, not on the board.
    expect(within(gearSection).queryByText('M ×1')).not.toBeInTheDocument()

    const chip = within(gearSection).getByRole('button', { name: /show sizes for BCD/i })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    await user.click(chip)

    // Each size, its count, and who it's for.
    expect(within(gearSection).getByText('M ×1')).toBeInTheDocument()
    expect(within(gearSection).getByText('L ×1')).toBeInTheDocument()
    expect(within(gearSection).getByText('Ada')).toBeInTheDocument()
    expect(within(gearSection).getByText('Bo')).toBeInTheDocument()
    expect(chip).toHaveAttribute('aria-expanded', 'true')

    // Clicking again puts it away.
    await user.click(within(gearSection).getByRole('button', { name: /hide sizes for BCD/i }))
    expect(within(gearSection).queryByText('M ×1')).not.toBeInTheDocument()
  })

  it('ticks each diver\'s piece off as it goes on the van, and shows how far along the size is', async () => {
    const user = userEvent.setup()
    const sizedBookings = [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } },
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } },
    ]
    const sizedProfiles = [{ ...profiles[0], bcd_size: 'M' }, { ...profiles[1], bcd_size: 'M' }]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: sizedBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: sizedProfiles })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    const gearSection = within(overall).getByText(/gear to pack/i).closest('div')!
    await user.click(within(gearSection).getByRole('button', { name: /show sizes for BCD/i }))

    // Both pieces start unpacked, and no progress is claimed.
    const ada = within(gearSection).getByRole('button', { name: /mark ada's bcd as packed/i })
    expect(ada).toHaveAttribute('aria-pressed', 'false')
    expect(within(gearSection).queryByText(/packed/i)).not.toBeInTheDocument()

    await user.click(ada)
    expect(within(gearSection).getByRole('button', { name: /mark ada's bcd as not packed/i }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(within(gearSection).getByText(/1\/2 packed/i)).toBeInTheDocument()

    // The second piece completes the size, which says so rather than "2/2".
    await user.click(within(gearSection).getByRole('button', { name: /mark bo's bcd as packed/i }))
    expect(within(gearSection).getByText(/all packed/i)).toBeInTheDocument()

    // Clicking a packed piece puts it back.
    await user.click(within(gearSection).getByRole('button', { name: /mark ada's bcd as not packed/i }))
    expect(within(gearSection).getByRole('button', { name: /mark ada's bcd as packed/i }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(within(gearSection).getByText(/1\/2 packed/i)).toBeInTheDocument()
  })

  it('remembers what is packed across a reload, per day', async () => {
    const user = userEvent.setup()
    fetchUpcomingEventDays.mockResolvedValue([todayKey, tomorrowKey])
    const sizedBookings = [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: sizedBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: [{ ...profiles[0], bcd_size: 'M' }] })
      return mockQueryBuilder({ data: [] })
    })

    const openBcd = async () => {
      const overall = (await screen.findByText(/^overall/i)).closest('section')!
      const gearSection = within(overall).getByText(/gear to pack/i).closest('div')!
      await user.click(within(gearSection).getByRole('button', { name: /show sizes for BCD/i }))
      return gearSection
    }

    const first = renderPage()
    await user.click(within(await openBcd()).getByRole('button', { name: /mark ada's bcd as packed/i }))
    first.unmount()

    // Same day: the tick survives.
    renderPage()
    expect(within(await openBcd()).getByRole('button', { name: /mark ada's bcd as not packed/i }))
      .toHaveAttribute('aria-pressed', 'true')

    // Tomorrow keeps its own list — today's packing says nothing about it.
    await user.click(screen.getByRole('tab', { name: /tomorrow/i }))
    expect(within(await openBcd()).getByRole('button', { name: /mark ada's bcd as packed/i }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('leaves one-size gear as a plain chip with nothing to open', async () => {
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    const overall = screen.getByText(/^overall/i).closest('section')!
    const gearSection = within(overall).getByText(/gear to pack/i).closest('div')!
    // The default fixtures rent a BCD and a Wetsuit — both sized, both buttons.
    expect(within(gearSection).getByRole('button', { name: /show sizes for BCD/i })).toBeInTheDocument()
    // A regulator has no size column, so its chip is not a control at all.
    expect(within(gearSection).queryByRole('button', { name: /regulator/i })).not.toBeInTheDocument()
  })

  it('shows divers with no size on file rather than dropping them from the list', async () => {
    const user = userEvent.setup()
    const sizedBookings = [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed',
        details: { gear: { rent: true, items: ['Wetsuit'] } } },
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed',
        details: { gear: { rent: true, items: ['Wetsuit'] } } },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: sizedBookings })
      // Ada has a wetsuit size; Bo has none — he's the one to chase.
      if (table === 'profiles') return mockQueryBuilder({ data: [{ ...profiles[0], wetsuit_size: 'S' }, profiles[1]] })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    const gearSection = within(overall).getByText(/gear to pack/i).closest('div')!
    await user.click(within(gearSection).getByRole('button', { name: /show sizes for Wetsuit/i }))

    expect(within(gearSection).getByText('S ×1')).toBeInTheDocument()
    expect(within(gearSection).getByText(/no size on file ×1/i)).toBeInTheDocument()
    expect(within(gearSection).getByText('Bo')).toBeInTheDocument()
  })

  it('keeps a waitlisted diver out of the seated prep totals and surfaces them as tentative', async () => {
    const mixed = [
      // Ada is confirmed — her BCD counts toward "Gear to pack".
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed',
        details: { transportation: true, gear: { rent: true, items: ['BCD'] } } },
      // Bo is waitlisted — his Wetsuit is tentative, not part of the boat's load,
      // and he needs no van seat until he clears the list.
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'waitlisted',
        details: { transportation: true, gear: { rent: true, items: ['Wetsuit'] } } },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: mixed })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()

    // Roster + header count seated divers only: one diver, one to ride.
    await screen.findByText(/1 event · 1 diver/i)
    const overall = screen.getByText(/^overall/i).closest('section')!
    // Ada's BCD is packed; Bo's Wetsuit is NOT in the seated "Gear to pack".
    const gearSection = within(overall).getByText(/gear to pack/i).closest('div')!
    expect(within(gearSection).getByText('BCD ×1')).toBeInTheDocument()
    expect(within(gearSection).queryByText('Wetsuit ×1')).not.toBeInTheDocument()

    // The Tentative block names the waitlisted diver and his extra load.
    const tentative = within(overall).getByText(/tentative — 1 waitlisted/i).closest('div')!
    expect(within(tentative).getByText('Bo')).toBeInTheDocument()
    expect(within(tentative).getByText('Wetsuit ×1')).toBeInTheDocument()
    // Ada (seated) is not listed as tentative.
    expect(within(tentative).queryByText('Ada')).not.toBeInTheDocument()
  })

  it('groups waitlisted diver cards under a Waitlist heading within the event', async () => {
    const mixed = [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed',
        details: { gear: { rent: true, items: ['BCD'] } } },
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'waitlisted',
        details: { gear: { rent: true, items: ['Wetsuit'] } } },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: mixed })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    await screen.findByText(/1 event · 1 diver/i)

    // Both cards render; the waitlisted one carries the badge.
    expect(screen.getByText(/waitlist \(1\)/i)).toBeInTheDocument()
    expect(screen.getAllByText('Waitlisted').length).toBeGreaterThan(0)
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

  it('nets discounts/surcharges and credit-funded payments into the balance, like the event page', async () => {
    const amendBookings = [
      // Ada: 3,200 discounted by 700 → owes 2,500, settled entirely by spending
      // account credit (which lands as a 'paid' account_credit payment row).
      // She is all paid up and must not show as owing the undiscounted 700.
      { id: 'b1', user_id: 'u1', payer_id: 'u1', event_id: 'e1', status: 'confirmed',
        details: { transportation: false, gear: { rent: false }, total: 3200 } },
      // Bo: 2,800 plus a 300 surcharge → owes 3,100, paid 1,000 → 2,100 due.
      { id: 'b2', user_id: 'u2', payer_id: 'u2', event_id: 'e1', status: 'confirmed',
        details: { transportation: false, gear: { rent: false }, total: 2800 } },
    ]
    const amendments = [
      { id: 'a1', booking_id: 'b1', amount: -700, note: 'Loyalty discount', created_by: 'admin-1', created_at: '' },
      { id: 'a2', booking_id: 'b2', amount: 300,  note: 'Late nitrox add',  created_by: 'admin-1', created_at: '' },
    ]
    const payments = [
      { id: 'p1', booking_id: 'b1', amount: 2500, status: 'paid', method: 'account_credit' },
      { id: 'p2', booking_id: 'b2', amount: 1000, status: 'paid', method: 'cash' },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: amendBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'payments') return mockQueryBuilder({ data: payments })
      if (table === 'booking_amendments') return mockQueryBuilder({ data: amendments })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    // Only Bo owes: 2,100 — not Ada's phantom 700 from ignoring the discount.
    const overall = screen.getByText(/^overall/i).closest('section')!
    expect(within(overall).getByText(/1 diver still owe/i)).toBeInTheDocument()
    expect(within(overall).getByText(/2,100 outstanding/i)).toBeInTheDocument()

    const due = screen.getByRole('group', { name: /payments due/i })
    expect(within(due).getByText(/Bo/)).toBeInTheDocument()
    expect(within(due).getByText(/2,100 due/)).toBeInTheDocument()
    expect(within(due).queryByText(/Ada/)).not.toBeInTheDocument()
    expect(within(due).queryByText(/700 due/)).not.toBeInTheDocument()
  })

  it('drops an event from Payments due entirely once every diver is settled', async () => {
    // One diver, fully discounted to zero — the group should not render at all.
    const freeBooking = [
      { id: 'b1', user_id: 'u1', payer_id: 'u1', event_id: 'e1', status: 'confirmed',
        details: { transportation: false, gear: { rent: false }, total: 1500 } },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: freeBooking })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'booking_amendments') return mockQueryBuilder({ data: [
        { id: 'a1', booking_id: 'b1', amount: -1500, note: 'Comped', created_by: 'admin-1', created_at: '' },
      ] })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    await screen.findByText(/1 event · 1 diver/i)
    expect(screen.queryByRole('group', { name: /payments due/i })).not.toBeInTheDocument()
  })

  it('lists every diver on the day in the Overall summary, each person once', async () => {
    // Ada dives both of the day's events; Bo dives one. The roster is a list of
    // people to brief and check off, so Ada must appear once — not twice.
    const twoEvents = [
      diveEvent,
      { id: 'e2', type: 'dive', title: 'Green Island', has_transport: true, start_time: '2026-06-18T06:00:00Z', end_time: null },
    ]
    const spanningBookings = [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: { gear: { rent: false } } },
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: { gear: { rent: false } } },
      { id: 'b3', user_id: 'u1', event_id: 'e2', status: 'confirmed', details: { gear: { rent: false } } },
    ]
    fetchEventsInRange.mockResolvedValue(twoEvents)
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: spanningBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    // Headcount, not bookings: 3 bookings across 2 people reads as "2 divers",
    // agreeing with the roster rather than double-counting Ada.
    await screen.findByText(/2 events · 2 divers/i)

    const overall = screen.getByText(/^overall/i).closest('section')!
    const roster = within(overall).getByRole('heading', { name: /^divers$/i }).parentElement!
    expect(within(roster).getAllByText('Ada')).toHaveLength(1)
    expect(within(roster).getByText('Bo')).toBeInTheDocument()
  })

  it('plans which vehicles carry the divers who need a ride', async () => {
    // One on-duty staff rides along; Ada needs a ride, Bo self-transports.
    const duties = [
      { id: 'd1', assignee_id: 's1', role: 'guide', event_id: 'e1', start_date: '2026-06-18', end_date: null },
    ]
    const withStaff = [...profiles, { id: 's1', name: 'Dana', contact_id: '0999', gear_owned: [] }]
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
    // Scoped to the car's row because Ada also appears in the day's diver list.
    const car = (await within(overall).findByText('Delica')).closest('li')!
    expect(within(car).getByText('Ada')).toBeInTheDocument()
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
    // Ada needs a ride but no car is on her event, so the run has no ride at all
    // and the unassigned Delica is not used to carry her.
    expect(await within(overall).findByText(/No car assigned — 1 rider/i)).toBeInTheDocument()
    expect(within(overall).queryByText(/Delica/)).not.toBeInTheDocument()
  })

  // ── Shared transport (runs) ───────────────────────────────────────────────
  // Two events on one day: a dive at Bat Cave and a Refresher course. Whether
  // they can share a van is the shop's call (event_ride_groups), and every seat
  // number follows from it.
  const twoEventDay = () => {
    const events = [
      diveEvent,
      { id: 'e2', type: 'course', title: 'Refresher Course', has_transport: true, start_time: '2026-06-18T00:00:00Z', end_time: null },
    ]
    fetchEventsInRange.mockResolvedValue(events)
    const twoBookings = [
      ...bookings,
      { id: 'b3', user_id: 'u3', event_id: 'e2', status: 'pending',
        details: { transportation: true, gear: { rent: false, items: [] } } },
    ]
    const threeProfiles = [...profiles, { id: 'u3', name: 'Cy', contact_id: '0902', gear_owned: [] }]
    return { twoBookings, threeProfiles }
  }

  it('pools riders and cars across events that travel together', async () => {
    const { twoBookings, threeProfiles } = twoEventDay()
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: twoBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: threeProfiles })
      if (table === 'vehicles') return mockQueryBuilder({ data: [
        { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 8, active: true, created_by: null },
      ] })
      // The Delica is on the dive only; the course rides in it by sharing the run.
      if (table === 'event_vehicles') return mockQueryBuilder({ data: [
        { id: 'ev1', vehicle_id: 'v1', event_id: 'e1' },
      ] })
      if (table === 'event_ride_groups') return mockQueryBuilder({ data: [
        { ride_day: todayKey, event_id: 'e1', group_id: 'g1', created_at: '', created_by: null },
        { ride_day: todayKey, event_id: 'e2', group_id: 'g1', created_at: '', created_by: null },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    await screen.findByText(/2 events · 3 divers/i)

    const overall = screen.getByText(/^overall/i).closest('section')!
    // One run, one car, both events' ride-needing divers aboard — the course's
    // diver is not left seatless just because the car is booked to the dive.
    expect(await within(overall).findByText(/Take 1 vehicle — 8 seats for 2 riders/i)).toBeInTheDocument()
    expect(within(overall).queryByText(/No car assigned/i)).not.toBeInTheDocument()
    expect(within(overall).queryByText(/separate run/i)).not.toBeInTheDocument()
  })

  it('plans events that ride alone as separate runs, without pooling their slack', async () => {
    const { twoBookings, threeProfiles } = twoEventDay()
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: twoBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: threeProfiles })
      if (table === 'vehicles') return mockQueryBuilder({ data: [
        { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 8, active: true, created_by: null },
      ] })
      if (table === 'event_vehicles') return mockQueryBuilder({ data: [
        { id: 'ev1', vehicle_id: 'v1', event_id: 'e1' },
      ] })
      // No grouping rows: two runs.
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    await screen.findByText(/2 events · 3 divers/i)

    const overall = screen.getByText(/^overall/i).closest('section')!
    expect(await within(overall).findByText(/2 separate runs · 2 riders/i)).toBeInTheDocument()
    // The dive's Delica seats its diver; the course's diver has no car at all,
    // and the Delica's spare seats are NOT offered to them.
    expect(within(overall).getByText(/Take 1 vehicle — 8 seats for 1 rider/i)).toBeInTheDocument()
    expect(within(overall).getByText(/No car assigned — 1 rider/i)).toBeInTheDocument()
  })

  it('leaves a dry course out of the day\'s runs entirely', async () => {
    // events.has_transport false: nobody travels to it. Counted as a run, its
    // on-duty instructor would be a rider needing a seat in a car that is not
    // going anywhere, and the board would call the day short of vehicles.
    const { twoBookings, threeProfiles } = twoEventDay()
    fetchEventsInRange.mockResolvedValue([
      diveEvent,
      { id: 'e2', type: 'course', title: 'Emergency First Response', has_transport: false,
        start_time: '2026-06-18T00:00:00Z', end_time: null },
    ])
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: twoBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: threeProfiles })
      if (table === 'vehicles') return mockQueryBuilder({ data: [
        { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 8, active: true, created_by: null },
      ] })
      if (table === 'event_vehicles') return mockQueryBuilder({ data: [
        { id: 'ev1', vehicle_id: 'v1', event_id: 'e1' },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    renderPage()
    await screen.findByText(/2 events · 3 divers/i)

    const overall = screen.getByText(/^overall/i).closest('section')!
    // One run — the dive's — and no carless second run for the course.
    expect(await within(overall).findByText(/Take 1 vehicle — 8 seats for 1 rider/i)).toBeInTheDocument()
    expect(within(overall).queryByText(/separate runs/i)).not.toBeInTheDocument()
    expect(within(overall).queryByText(/No car assigned/i)).not.toBeInTheDocument()
  })

  it('lets an admin put two events on the same run', async () => {
    const { twoBookings, threeProfiles } = twoEventDay()
    const upsert = vi.fn()
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: twoBookings })
      if (table === 'profiles') return mockQueryBuilder({ data: threeProfiles })
      if (table === 'event_ride_groups') {
        const b = mockQueryBuilder({ data: [] })
        b.upsert = (...a: unknown[]) => { upsert(...a); return b }
        return b
      }
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/2 events · 3 divers/i)

    await user.selectOptions(
      screen.getByLabelText(/Shared transport for Kenting fun dive/i),
      'e2',
    )
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    const rows = upsert.mock.calls[0][0] as Array<{ event_id: string; ride_day: string }>
    expect(rows.map(r => r.event_id).sort()).toEqual(['e1', 'e2'])
    expect(rows[0].ride_day).toBe(todayKey)
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

  it('jumps to tomorrow from today when tomorrow is the next day with events', async () => {
    fetchUpcomingEventDays.mockResolvedValue([todayKey, tomorrowKey])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    // Labelled with where it lands, and it activates the Tomorrow tab rather
    // than dumping the admin into the "Other day" picker.
    await user.click(await screen.findByRole('button', { name: /next: tomorrow/i }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /tomorrow/i })).toHaveAttribute('aria-selected', 'true')
    })
    expect(fetchEventsInRange.mock.calls.at(-1)![0]).toBe(tomorrowKey)
  })

  it('skips dead days — the jump lands on the next day that actually has events', async () => {
    // Nothing tomorrow; the next real event day is 9 days out.
    const farOff = dayKeyOffset(todayKey, 9)
    fetchUpcomingEventDays.mockResolvedValue([todayKey, farOff])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    await user.click(await screen.findByRole('button', { name: new RegExp(`next: ${farOff}`, 'i') }))
    await waitFor(() => {
      expect(fetchEventsInRange.mock.calls.at(-1)![0]).toBe(farOff)
    })
    expect(screen.getByRole('tab', { name: /other day/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('diffs today\'s packed gear against tomorrow\'s, size by size', async () => {
    // Back-to-back days: today's M BCD covers tomorrow's M diver, today's S
    // comes home, and tomorrow's XL still has to be pulled off the rack.
    fetchUpcomingEventDays.mockResolvedValue([todayKey, tomorrowKey])
    const tomorrowEvent = { ...diveEvent, id: 'e2', title: 'Sunday fun dive' }
    fetchEventsInRange.mockImplementation((day: string) =>
      Promise.resolve([day === tomorrowKey ? tomorrowEvent : diveEvent]))

    const bookingsByEvent: Record<string, unknown[]> = {
      e1: [
        { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } },
        { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } },
      ],
      e2: [
        { id: 'b3', user_id: 'u3', event_id: 'e2', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } },
        { id: 'b4', user_id: 'u4', event_id: 'e2', status: 'confirmed', details: { gear: { rent: true, items: ['BCD'] } } },
      ],
    }
    const sizedProfiles = [
      { ...profiles[0], bcd_size: 'M' },
      { ...profiles[1], bcd_size: 'S' },
      { id: 'u3', name: 'Cy', gear_owned: [], bcd_size: 'M' },
      { id: 'u4', name: 'Di', gear_owned: [], bcd_size: 'XL' },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        // The day loader and the next-day loader both filter by event id, so
        // hand each the bookings for the events it actually asked about.
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.in = (_col: string, ids: string[]) =>
          mockQueryBuilder({ data: ids.flatMap(id => bookingsByEvent[id] ?? []) })
        return b
      }
      if (table === 'profiles') return mockQueryBuilder({ data: sizedProfiles })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)

    await user.click(await screen.findByRole('button', { name: /show the next day's gear diff/i }))
    // It has to open next to the button that asks for it: further down the
    // Overall board and a phone shows no visible response to the tap.
    const panel = await screen.findByText(new RegExp(`next day — ${tomorrowKey}`, 'i'))
    const gearBlock = screen.getByText(/gear to pack/i)
    expect(panel.compareDocumentPosition(gearBlock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(within(await screen.findByRole('group', { name: /stays out/i })).getByText('BCD · M ×1')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: /also pack/i })).getByText('BCD · XL ×1')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: /back to the shop/i })).getByText('BCD · S ×1')).toBeInTheDocument()

    // Closing puts it away without disturbing the rest of the board.
    await user.click(screen.getByRole('button', { name: /hide the next day's gear diff/i }))
    expect(screen.queryByRole('group', { name: /stays out/i })).not.toBeInTheDocument()
  })

  it('offers no gear diff when the next event day is not the very next day', async () => {
    // Gear sitting through a gap gets dried and racked anyway, so carrying it
    // over is not advice anyone can act on.
    fetchUpcomingEventDays.mockResolvedValue([todayKey, dayKeyOffset(todayKey, 9)])
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    expect(screen.queryByRole('button', { name: /next day's gear diff/i })).not.toBeInTheDocument()
  })

  it('hides the jump button on the last day that has events', async () => {
    fetchUpcomingEventDays.mockResolvedValue([todayKey])
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    expect(screen.queryByRole('button', { name: /next:/i })).not.toBeInTheDocument()
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
    const withStaff = [...profiles, { id: 's1', name: 'Dana', contact_id: '0999', gear_owned: [] }]
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

  it('links every name chip on the Overall board to that person\'s directory card', async () => {
    const duties = [
      { id: 'd1', assignee_id: 's1', role: 'guide', event_id: 'e1', start_date: todayKey, end_date: null },
    ]
    const withWaitlist = [
      ...bookings,
      { id: 'b3', user_id: 'u3', event_id: 'e1', status: 'waitlisted', details: {} },
    ]
    const allProfiles = [
      ...profiles,
      { id: 's1', name: 'Dana', gear_owned: [] },
      { id: 'u3', name: 'Eve',  gear_owned: [] },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: withWaitlist })
      if (table === 'profiles') return mockQueryBuilder({ data: allProfiles })
      if (table === 'duties') return mockQueryBuilder({ data: duties })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    // Seated diver, on-duty staff and waitlisted diver — all three rosters.
    expect(within(overall).getByRole('link', { name: /view Ada's profile/i }))
      .toHaveAttribute('href', '/admin/users?diver=u1')
    expect(within(overall).getByRole('link', { name: /view Dana's profile/i }))
      .toHaveAttribute('href', '/admin/users?diver=s1')
    expect(within(overall).getByRole('link', { name: /view Eve's profile/i }))
      .toHaveAttribute('href', '/admin/users?diver=u3')
  })

  it('keeps the staff chip announcing the person, not their duty list', async () => {
    const duties = [
      { id: 'd1', assignee_id: 's1', role: 'guide', event_id: 'e1', start_date: todayKey, end_date: null },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: [...profiles, { id: 's1', name: 'Dana', gear_owned: [] }] })
      if (table === 'duties') return mockQueryBuilder({ data: duties })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    // The role stays visible on the chip; it just isn't the link's name.
    const chip = within(overall).getByRole('link', { name: /view Dana's profile/i })
    expect(chip).toHaveTextContent(/guide/)
  })

  it('leaves the board name chips plain for staff, who cannot open the directory', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 's-1', role: 'staff' } })
    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    expect(within(overall).getByText('Ada')).toBeInTheDocument()
    expect(within(overall).queryByRole('link', { name: /view Ada's profile/i })).not.toBeInTheDocument()
  })

  it('leaves a booking with no profile plain — there is no card to open', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: [bookings[0]] })
      if (table === 'profiles') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })

    renderPage()
    const overall = (await screen.findByText(/^overall/i)).closest('section')!
    expect(within(overall).getByText('(no profile)').closest('a')).toBeNull()
  })

  it('sends the event title to the event page and the Edit button to the editor — not both to edit', async () => {
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    // Two distinct destinations: the title is navigation to the event, the
    // button is the edit action. Pointing both at /edit made the title useless.
    expect(screen.getByRole('link', { name: 'Kenting fun dive' })).toHaveAttribute('href', '/admin/events/e1')
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', '/admin/events/e1/edit')
  })

  it('still links the event title for staff, but offers them no Edit button', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 's-1', role: 'staff' } })
    renderPage()
    await screen.findByText(/1 event · 2 divers/i)
    // /admin/events/:id is staff-readable, so staff keep the title link; only
    // the admin-only editor is withheld.
    expect(screen.getByRole('link', { name: 'Kenting fun dive' })).toHaveAttribute('href', '/admin/events/e1')
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument()
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

// ── With no signal ─────────────────────────────────────────────────────
// The board is the surface staff read on a boat, so it has to render off the
// device and be visibly labelled as having done so.

function offlineCtx(over: Partial<OfflineContextValue> = {}): OfflineContextValue {
  return { snapshot: null, status: 'synced', online: true, refresh: vi.fn(), ...over }
}

function snapshotWith(boards: Record<string, DayBoardData>): OfflineSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    userId: 'admin-1',
    capturedAt: '2026-08-15T07:14:00Z',
    days: Object.keys(boards),
    upcomingDays: [],
    vehicles: [],
    gearModels: [],
    boards,
    transport: {},
  }
}

const storedBoard: DayBoardData = {
  ...EMPTY_DAY_BOARD,
  events: [diveEvent] as unknown as DayBoardData['events'],
  bookings: bookings as unknown as DayBoardData['bookings'],
  profiles: profiles as unknown as DayBoardData['profiles'],
}

function renderOffline(ctx: OfflineContextValue) {
  return render(
    <MemoryRouter>
      <OfflineContext.Provider value={ctx}>
        <AdminLogisticsPage />
      </OfflineContext.Provider>
    </MemoryRouter>,
  )
}

describe('AdminLogisticsPage with no signal', () => {
  it('renders the day off the device and says the copy is stored', async () => {
    const ctx = offlineCtx({ online: false, snapshot: snapshotWith({ [todayKey]: storedBoard }) })
    renderOffline(ctx)

    expect(await screen.findByText(/Kenting fun dive/)).toBeInTheDocument()
    expect(screen.getAllByText(/Ada/).length).toBeGreaterThan(0)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/no connection/i)
    expect(status).toHaveTextContent(/Aug 15/)
  })

  it('never touches the network when the browser reports no connection', async () => {
    renderOffline(offlineCtx({ online: false, snapshot: snapshotWith({ [todayKey]: storedBoard }) }))
    await screen.findByText(/Kenting fun dive/)
    expect(fetchEventsInRange).not.toHaveBeenCalled()
  })

  // The one case the board must not render as a quiet day: it genuinely does
  // not know, and saying "no events scheduled" would be a confident wrong answer.
  it('says the day was never saved rather than showing it as empty', async () => {
    renderOffline(offlineCtx({ online: false, snapshot: snapshotWith({ '2020-01-01': EMPTY_DAY_BOARD }) }))
    expect(await screen.findByText(t.admin.logistics.offline.unavailable)).toBeInTheDocument()
    expect(screen.queryByText(/no events scheduled/i)).not.toBeInTheDocument()
  })

  it('says so when the device holds nothing at all', async () => {
    renderOffline(offlineCtx({ online: false, snapshot: null }))
    expect(await screen.findByText(t.admin.logistics.offline.unavailable)).toBeInTheDocument()
  })

  // A captured day with no events is an answer, and reads as one.
  it('shows a captured but quiet day as quiet', async () => {
    renderOffline(offlineCtx({ online: false, snapshot: snapshotWith({ [todayKey]: EMPTY_DAY_BOARD }) }))
    expect(await screen.findByText(/no events scheduled/i)).toBeInTheDocument()
  })

  // The browser reports a connection because there is a bar of signal or a
  // captive portal; the read still fails. Nobody gets to toggle a flag first.
  it('falls back to the device when a live read fails despite being "online"', async () => {
    fetchEventsInRange.mockRejectedValue(new Error('network'))
    renderOffline(offlineCtx({ online: true, snapshot: snapshotWith({ [todayKey]: storedBoard }) }))
    expect(await screen.findByText(/Kenting fun dive/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/no connection/i)
  })

  it('keeps reading live when there is a connection, and stays quiet about it', async () => {
    renderOffline(offlineCtx({ online: true, snapshot: snapshotWith({ [todayKey]: storedBoard }) }))
    await screen.findByText(/Kenting fun dive/)
    expect(fetchEventsInRange).toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('plans rides off the stored fleet when the vehicles read fails', async () => {
    renderOffline(offlineCtx({
      online: false,
      snapshot: {
        ...snapshotWith({ [todayKey]: storedBoard }),
        vehicles: [
          { id: 'v1', name: 'Shop van', passenger_seats: 7, active: true, created_at: '', created_by: null },
        ] as unknown as OfflineSnapshot['vehicles'],
      },
    }))
    await screen.findByText(/Kenting fun dive/)
    // Without the stored fleet the planner reports an empty catalog and offers
    // no plan at all; with it, the seven seats are there to allocate.
    await waitFor(() =>
      expect(screen.queryByText(new RegExp(t.admin.transport.noFleetPrefix))).not.toBeInTheDocument())
  })

  it('reports an empty fleet when the device holds none either', async () => {
    renderOffline(offlineCtx({ online: false, snapshot: snapshotWith({ [todayKey]: storedBoard }) }))
    await screen.findByText(/Kenting fun dive/)
    expect(await screen.findByText(new RegExp(t.admin.transport.noFleetPrefix))).toBeInTheDocument()
  })
})
