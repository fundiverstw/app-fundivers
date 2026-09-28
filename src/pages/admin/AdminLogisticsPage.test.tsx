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

function mockDay({ bookingRows = bookings, profileRows = profiles, extra = {} }: {
  bookingRows?: unknown[]
  profileRows?: unknown[]
  extra?: Record<string, unknown[]>
} = {}) {
  from.mockImplementation((table: string) => {
    if (table === 'bookings') return mockQueryBuilder({ data: bookingRows })
    if (table === 'profiles') return mockQueryBuilder({ data: profileRows })
    return mockQueryBuilder({ data: extra[table] ?? [] })
  })
}

const rent = (items: string[]) => ({ gear: { rent: true, items } })

// The board has loaded once its section tabs are up.
const loaded = () => screen.findByRole('tab', { name: /^gear/i })

async function openSection(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('tab', { name }))
  return screen.getByRole('tabpanel')
}

describe('AdminLogisticsPage — gear checklist', () => {
  it('opens on the gear checklist, one card per guest holding only their own pieces', async () => {
    renderPage()
    await loaded()
    expect(screen.getByRole('tab', { name: /^gear/i })).toHaveAttribute('aria-selected', 'true')

    const ada = screen.getByRole('article', { name: 'Ada' })
    expect(within(ada).getByRole('button', { name: /mark ada's bcd as packed/i })).toBeInTheDocument()
    expect(within(ada).queryByRole('button', { name: /wetsuit/i })).not.toBeInTheDocument()

    const bo = screen.getByRole('article', { name: 'Bo' })
    expect(within(bo).getByRole('button', { name: /mark bo's wetsuit as packed/i })).toBeInTheDocument()
  })

  it('puts the size to pull on the piece itself', async () => {
    mockDay({ profileRows: [{ ...profiles[0], bcd_size: 'M' }, { ...profiles[1], wetsuit_size: 'L' }] })
    renderPage()
    await loaded()

    const ada = screen.getByRole('article', { name: 'Ada' })
    const bcd = within(ada).getByRole('button', { name: /mark ada's bcd m as packed/i })
    expect(bcd).toHaveTextContent('Size M')
  })

  it('flags a piece with no size on file, and offers to add it', async () => {
    renderPage()
    await loaded()

    const bo = screen.getByRole('article', { name: 'Bo' })
    expect(within(bo).getByRole('button', { name: /mark bo's wetsuit as packed/i })).toHaveTextContent('No size on file')
    expect(within(bo).getByRole('button', { name: /bo's sizes/i })).toHaveTextContent('Add missing size')
  })

  it('opens the size editor on the card', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    const bo = screen.getByRole('article', { name: 'Bo' })
    const toggle = within(bo).getByRole('button', { name: /bo's sizes/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(bo).getByLabelText('Wetsuit')).toBeInTheDocument()
  })

  it('counts each tick on the card, on the day and on the Gear tab', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()
    expect(screen.getByText('0 of 2 pieces packed')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^gear, 0 of 2 pieces packed/i })).toHaveTextContent('0/2')

    const bo = screen.getByRole('article', { name: 'Bo' })
    await user.click(within(bo).getByRole('button', { name: /mark bo's wetsuit as packed/i }))

    expect(screen.getByText('1 of 2 pieces packed')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 guests ready')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^gear, 1 of 2 pieces packed/i })).toHaveTextContent('1/2')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
  })

  it('says the day is done once every seated piece is ticked', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()
    await user.click(screen.getByRole('button', { name: /mark ada's bcd as packed/i }))
    await user.click(screen.getByRole('button', { name: /mark bo's wetsuit as packed/i }))
    expect(screen.getByText('Everything is packed.')).toBeInTheDocument()
  })

  it('remembers what is packed across a reload, per day', async () => {
    const user = userEvent.setup()
    fetchUpcomingEventDays.mockResolvedValue([todayKey, tomorrowKey])

    const first = renderPage()
    await loaded()
    await user.click(screen.getByRole('button', { name: /mark bo's wetsuit as packed/i }))
    first.unmount()

    // Same day: the tick survives, and Bo's finished card has folded away.
    renderPage()
    await loaded()
    expect(within(screen.getByRole('article', { name: 'Bo' })).getByText(/all 1 packed/i)).toBeInTheDocument()

    // Tomorrow keeps its own list — today's packing says nothing about it.
    await user.click(screen.getByRole('tab', { name: /tomorrow/i }))
    expect(await screen.findByRole('button', { name: /mark bo's wetsuit as packed/i }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it('folds a finished guest to one line, and opens it again on request', async () => {
    const user = userEvent.setup()
    mockDay({ bookingRows: [{ id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: rent(['BCD', 'Wetsuit']) }] })
    renderPage()
    await loaded()

    const card = () => screen.getByRole('article', { name: 'Ada' })
    await user.click(within(card()).getByRole('button', { name: /mark all of ada's gear as packed/i }))
    expect(within(card()).getByText(/all 2 packed/i)).toBeInTheDocument()
    expect(within(card()).queryByRole('button', { name: /bcd/i })).not.toBeInTheDocument()

    await user.click(within(card()).getByRole('button', { name: /show ada's gear/i }))
    expect(within(card()).getByRole('button', { name: /mark ada's bcd as not packed/i }))
      .toHaveAttribute('aria-pressed', 'true')

    // And back off the van again, all at once.
    await user.click(within(card()).getByRole('button', { name: /mark all of ada's gear as not packed/i }))
    expect(within(card()).getByRole('button', { name: /mark ada's bcd as packed/i }))
      .toHaveAttribute('aria-pressed', 'false')
  })

  it("puts delicate kit and add-ons on the renter's own card", async () => {
    mockDay({
      bookingRows: [
        { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'pending',
          details: { gear: { rent: true, items: ['BCD', 'Dive computer'] }, add_ons: [] } },
        { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'pending',
          details: { gear: { rent: false }, add_ons: ['light2', 'smb'] } },
      ],
      extra: { addons: [
        { id: 'light2', display_title: 'Light Rental (2 Days)', admin_title: 'Light 2' },
        { id: 'smb',    display_title: 'SMB Rental',            admin_title: 'SMB' },
      ] },
    })
    renderPage()
    await loaded()

    const ada = screen.getByRole('article', { name: 'Ada' })
    expect(within(ada).getByRole('button', { name: /mark ada's dive computer as packed/i })).toHaveTextContent('Handle with care')

    const bo = screen.getByRole('article', { name: 'Bo' })
    expect(within(bo).getByRole('button', { name: /mark bo's dive light as packed/i })).toHaveTextContent('Handle with care')
    expect(within(bo).getByRole('button', { name: /mark bo's smb rental as packed/i })).toHaveTextContent('Add-on')
    expect(within(ada).queryByText(/dive light/i)).not.toBeInTheDocument()
  })

  it('names the guests with nothing to pack instead of leaving them off', async () => {
    mockDay({ bookingRows: [
      bookings[0],
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'pending', details: { gear: { rent: false } } },
    ] })
    renderPage()
    await loaded()
    expect(screen.queryByRole('article', { name: 'Bo' })).not.toBeInTheDocument()
    expect(screen.getByText('No gear to pack:').parentElement).toHaveTextContent('Bo')
  })

  it("shows a guest's request for help on their card", async () => {
    mockDay({ bookingRows: [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'pending',
        details: { gear: { assistance_note: 'Needs a size XS hood' } } },
    ] })
    renderPage()
    await loaded()
    expect(within(screen.getByRole('article', { name: 'Ada' })).getByText('Needs a size XS hood')).toBeInTheDocument()
  })

  it('keeps waitlisted guests out of the day count, under a heading of their own', async () => {
    mockDay({ bookingRows: [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: rent(['BCD']) },
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'waitlisted', details: rent(['Wetsuit']) },
    ] })
    renderPage()
    await loaded()

    expect(screen.getByText('0 of 1 pieces packed')).toBeInTheDocument()
    const heading = screen.getByText(/waitlist \(1\) — pack only if they get a seat/i)
    const bo = within(heading.parentElement!).getByRole('article', { name: 'Bo' })
    expect(within(bo).getByText('Waitlisted')).toBeInTheDocument()
  })

  it('puts each guest under the event they are booked on', async () => {
    fetchEventsInRange.mockResolvedValue([
      diveEvent,
      { id: 'e2', type: 'dive', title: 'Green Island', has_transport: true, start_time: '2026-06-18T06:00:00Z', end_time: null },
    ])
    mockDay({
      bookingRows: [
        { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: rent(['BCD']) },
        { id: 'b3', user_id: 'u3', event_id: 'e2', status: 'confirmed', details: rent(['Fins']) },
      ],
      profileRows: [...profiles, { id: 'u3', name: 'Cy', gear_owned: [] }],
    })
    renderPage()
    await loaded()

    const kenting = screen.getByRole('link', { name: 'Kenting fun dive' }).closest('section')!
    const green = screen.getByRole('link', { name: 'Green Island' }).closest('section')!
    expect(within(kenting).getByRole('article', { name: 'Ada' })).toBeInTheDocument()
    expect(within(kenting).queryByRole('article', { name: 'Cy' })).not.toBeInTheDocument()
    expect(within(green).getByRole('article', { name: 'Cy' })).toBeInTheDocument()
  })

  it('lists the guests on an event alphabetically', async () => {
    mockDay({ bookingRows: [
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: rent(['BCD']) },
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: rent(['BCD']) },
    ] })
    renderPage()
    await loaded()
    expect(screen.getAllByRole('article').map(a => a.getAttribute('aria-label'))).toEqual(['Ada', 'Bo'])
  })

  it('turns the same list rack-side: by item, by size, one toggle per guest', async () => {
    const user = userEvent.setup()
    mockDay({
      bookingRows: [
        { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: rent(['BCD']) },
        { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: rent(['BCD']) },
      ],
      profileRows: [{ ...profiles[0], bcd_size: 'L' }, profiles[1]],
    })
    renderPage()
    await loaded()

    await user.click(screen.getByRole('radio', { name: /by item/i }))
    const bcd = screen.getByRole('listitem', { name: 'BCD' })
    expect(within(bcd).getByText('L')).toBeInTheDocument()
    expect(within(bcd).getByText('No size on file')).toBeInTheDocument()
    await user.click(within(bcd).getByRole('button', { name: /mark ada's bcd l as packed/i }))
    expect(within(bcd).getByText('1/2 packed')).toBeInTheDocument()

    // Ticked here, ticked on Ada's card.
    await user.click(screen.getByRole('radio', { name: /by guest/i }))
    expect(within(screen.getByRole('article', { name: 'Ada' })).getByText(/all 1 packed/i)).toBeInTheDocument()
  })

  it('says so when nobody rents anything', async () => {
    mockDay({ bookingRows: [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: { gear: { rent: false } } },
    ] })
    renderPage()
    await loaded()
    expect(screen.getByText(/nothing to pack/i)).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /by item/i })).not.toBeInTheDocument()
  })

  it('links each guest card to their People profile for admins only', async () => {
    const { unmount } = renderPage()
    await loaded()
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute('href', '/admin/users?diver=u1')
    unmount()

    useAuthMock.mockReturnValue({ profile: { id: 's-1', role: 'staff' } })
    renderPage()
    await loaded()
    expect(screen.queryByRole('link', { name: 'Ada' })).not.toBeInTheDocument()
  })

  it('sends the event title to the event page and the Edit button to the editor', async () => {
    renderPage()
    await loaded()
    expect(screen.getByRole('link', { name: 'Kenting fun dive' })).toHaveAttribute('href', '/admin/events/e1')
    expect(screen.getByRole('link', { name: /edit/i })).toHaveAttribute('href', '/admin/events/e1/edit')
  })

  it('still links the event title for staff, but offers them no Edit button', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 's-1', role: 'staff' } })
    renderPage()
    await loaded()
    expect(screen.getByRole('link', { name: 'Kenting fun dive' })).toHaveAttribute('href', '/admin/events/e1')
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument()
  })
})

describe('AdminLogisticsPage — rides', () => {
  // The day's plan sits above the per-event car blocks, which say "No car
  // assigned yet" about an event on their own.
  const dayPlan = (rides: HTMLElement) => within(rides).getByText(/need a ride/i).parentElement!
  const delica = { id: 'v1', created_at: '', name: 'Delica', passenger_seats: 7, active: true, created_by: null }

  it('offers a per-event car picker listing the day\'s available cars', async () => {
    const user = userEvent.setup()
    mockDay({ extra: { vehicles: [delica] } })
    renderPage()
    await openSection(user, /^rides/i)
    const cars = await screen.findByRole('group', { name: /assigned cars/i })
    expect(within(cars).getByText(/No car assigned yet/i)).toBeInTheDocument()
    const picker = within(cars).getByLabelText('Assign a car')
    expect(within(picker).getByRole('option', { name: 'Delica (7)' })).toBeInTheDocument()
  })

  it('counts riders and on-duty staff, and seats both in the assigned car', async () => {
    const user = userEvent.setup()
    mockDay({
      profileRows: [...profiles, { id: 's1', name: 'Dana', contact_id: '0999', gear_owned: [] }],
      extra: {
        duties: [{ id: 'd1', assignee_id: 's1', role: 'guide', event_id: 'e1', start_date: '2026-06-18', end_date: null }],
        vehicles: [delica],
        event_vehicles: [{ id: 'ev1', vehicle_id: 'v1', event_id: 'e1' }],
      },
    })
    renderPage()
    expect(await screen.findByRole('tab', { name: /^rides, 1 need a ride/i })).toHaveTextContent('1')
    const rides = await openSection(user, /^rides/i)

    expect(within(rides).getByText(/need a ride/i)).toHaveTextContent(/1 on-duty staff/i)
    expect(await within(rides).findByText(/Take 1 vehicle — 7 seats for 2 riders/i)).toBeInTheDocument()
    expect(within(rides).queryByText(/No seat/i)).not.toBeInTheDocument()
  })

  it('seats a rider even when no staff are on duty, with no driver concept', async () => {
    const user = userEvent.setup()
    mockDay({ extra: { vehicles: [delica], event_vehicles: [{ id: 'ev1', vehicle_id: 'v1', event_id: 'e1' }] } })
    renderPage()
    const rides = await openSection(user, /^rides/i)
    const car = (await within(rides).findByText('Delica')).closest('li')!
    expect(within(car).getByText('Ada')).toBeInTheDocument()
    expect(within(rides).queryByText(/driver/i)).not.toBeInTheDocument()
  })

  it('does not seat divers in a fleet car that is not assigned to their event', async () => {
    const user = userEvent.setup()
    mockDay({ extra: { vehicles: [delica] } })
    renderPage()
    const rides = await openSection(user, /^rides/i)
    expect(await within(rides).findByText(/No car assigned — 1 rider/i)).toBeInTheDocument()
    expect(within(rides).queryByText(/Take 1 vehicle/i)).not.toBeInTheDocument()
  })

  // Two events on one day: a dive and a Refresher course. Whether they can
  // share a van is the shop's call (event_ride_groups), and every seat number
  // follows from it.
  const twoEventDay = (courseHasTransport = true, extra: Record<string, unknown[]> = {}) => {
    fetchEventsInRange.mockResolvedValue([
      diveEvent,
      { id: 'e2', type: 'course', title: 'Refresher Course', has_transport: courseHasTransport, start_time: '2026-06-18T00:00:00Z', end_time: null },
    ])
    mockDay({
      bookingRows: [
        ...bookings,
        { id: 'b3', user_id: 'u3', event_id: 'e2', status: 'pending', details: { transportation: true, gear: { rent: false, items: [] } } },
      ],
      profileRows: [...profiles, { id: 'u3', name: 'Cy', contact_id: '0902', gear_owned: [] }],
      extra: {
        vehicles: [{ ...delica, passenger_seats: 8 }],
        event_vehicles: [{ id: 'ev1', vehicle_id: 'v1', event_id: 'e1' }],
        ...extra,
      },
    })
  }

  it('pools riders and cars across events that travel together', async () => {
    const user = userEvent.setup()
    twoEventDay(true, { event_ride_groups: [
      { ride_day: todayKey, event_id: 'e1', group_id: 'g1', created_at: '', created_by: null },
      { ride_day: todayKey, event_id: 'e2', group_id: 'g1', created_at: '', created_by: null },
    ] })
    renderPage()
    const rides = await openSection(user, /^rides/i)
    expect(await within(rides).findByText(/Take 1 vehicle — 8 seats for 2 riders/i)).toBeInTheDocument()
    expect(within(dayPlan(rides)).queryByText(/No car assigned/i)).not.toBeInTheDocument()
  })

  it('plans events that ride alone as separate runs, without pooling their slack', async () => {
    const user = userEvent.setup()
    twoEventDay()
    renderPage()
    const rides = await openSection(user, /^rides/i)
    expect(await within(rides).findByText(/2 separate runs · 2 riders/i)).toBeInTheDocument()
    expect(within(rides).getByText(/Take 1 vehicle — 8 seats for 1 rider/i)).toBeInTheDocument()
    expect(within(rides).getByText(/No car assigned — 1 rider/i)).toBeInTheDocument()
  })

  it('leaves a course with no transport out of the day\'s runs entirely', async () => {
    const user = userEvent.setup()
    twoEventDay(false)
    renderPage()
    const rides = await openSection(user, /^rides/i)
    expect(await within(rides).findByText(/Take 1 vehicle — 8 seats for 1 rider/i)).toBeInTheDocument()
    expect(within(rides).queryByText(/separate runs/i)).not.toBeInTheDocument()
    expect(within(dayPlan(rides)).queryByText(/No car assigned/i)).not.toBeInTheDocument()
  })

  it('lets an admin put two events on the same run', async () => {
    const user = userEvent.setup()
    twoEventDay()
    const upsert = vi.fn()
    const base = from.getMockImplementation()!
    from.mockImplementation((table: string) => {
      if (table !== 'event_ride_groups') return base(table)
      const b = mockQueryBuilder({ data: [] })
      b.upsert = (...a: unknown[]) => { upsert(...a); return b }
      return b
    })
    renderPage()
    await openSection(user, /^rides/i)

    await user.selectOptions(screen.getByLabelText(/Shared transport for Kenting fun dive/i), 'e2')
    await waitFor(() => expect(upsert).toHaveBeenCalled())
    const rows = upsert.mock.calls[0][0] as Array<{ event_id: string; ride_day: string }>
    expect(rows.map(r => r.event_id).sort()).toEqual(['e1', 'e2'])
    expect(rows[0].ride_day).toBe(todayKey)
  })

  it('prompts to add vehicles when riders need a ride but the fleet is empty', async () => {
    const user = userEvent.setup()
    renderPage()
    const rides = await openSection(user, /^rides/i)
    expect(within(rides).getByText(/No vehicles in the fleet yet/i)).toBeInTheDocument()
  })
})

describe('AdminLogisticsPage — people', () => {
  it('counts heads, not bookings, and lists each event\'s guests', async () => {
    const user = userEvent.setup()
    fetchEventsInRange.mockResolvedValue([
      diveEvent,
      { id: 'e2', type: 'dive', title: 'Green Island', has_transport: true, start_time: '2026-06-18T06:00:00Z', end_time: null },
    ])
    mockDay({ bookingRows: [
      { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: {} },
      { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: {} },
      { id: 'b3', user_id: 'u1', event_id: 'e2', status: 'confirmed', details: {} },
    ] })
    renderPage()
    expect(await screen.findByRole('tab', { name: /^people, 2 people/i })).toHaveTextContent('2')
    const people = await openSection(user, /^people/i)

    expect(within(people).getByText(/2 events · 2 divers/i)).toBeInTheDocument()
    const green = within(people).getByRole('link', { name: 'Green Island' }).closest('section')!
    expect(within(green).getByText('Ada')).toBeInTheDocument()
    expect(within(green).queryByText('Bo')).not.toBeInTheDocument()
  })

  it('lists a dry event\'s registrants as non-divers, apart from the divers', async () => {
    const user = userEvent.setup()
    // An EFR class and a fun dive on the same day: Ada dives, Cy does not, and
    // Bo does both — which makes Bo a diver, counted once.
    fetchEventsInRange.mockResolvedValue([
      diveEvent,
      { id: 'e2', type: 'course', title: 'EFR refresher', has_transport: false, enters_water: false, start_time: '2026-06-18T00:00:00Z', end_time: null },
    ])
    mockDay({
      bookingRows: [
        { id: 'b1', user_id: 'u1', event_id: 'e1', status: 'confirmed', details: {} },
        { id: 'b2', user_id: 'u2', event_id: 'e1', status: 'confirmed', details: {} },
        { id: 'b3', user_id: 'u2', event_id: 'e2', status: 'confirmed', details: {} },
        { id: 'b4', user_id: 'u3', event_id: 'e2', status: 'confirmed', details: {} },
      ],
      profileRows: [...profiles, { id: 'u3', name: 'Cy', contact_id: '0902', gear_owned: [] }],
    })
    renderPage()
    const people = await openSection(user, /^people/i)

    expect(within(people).getByText(/2 events · 2 divers/i)).toHaveTextContent(/1 non-diver/i)
    const dry = within(people).getByRole('group', { name: t.admin.logistics.nonDiversOnDay })
    expect(within(dry).getByText('Cy')).toBeInTheDocument()
    expect(within(dry).getByText('Bo')).toBeInTheDocument()
    expect(within(people).getByText(t.admin.logistics.dryEventBadge)).toBeInTheDocument()
  })

  it('lists on-duty staff per event with their role', async () => {
    const user = userEvent.setup()
    mockDay({
      profileRows: [...profiles, { id: 's1', name: 'Dana', contact_id: '0999', gear_owned: [] }],
      extra: { duties: [{ id: 'd1', assignee_id: 's1', role: 'guide', event_id: 'e1', start_date: '2026-06-18', end_date: null }] },
    })
    renderPage()
    const people = await openSection(user, /^people/i)
    expect(within(people).getByText(/1 staff/)).toBeInTheDocument()
    const group = within(people).getByRole('group', { name: /on-duty staff/i })
    expect(within(group).getByText(/Dana/)).toBeInTheDocument()
    expect(within(group).getByText(/guide/)).toBeInTheDocument()
  })

  it('links seated and waitlisted names to the directory for admins', async () => {
    const user = userEvent.setup()
    mockDay({
      bookingRows: [...bookings, { id: 'b3', user_id: 'u3', event_id: 'e1', status: 'waitlisted', details: {} }],
      profileRows: [...profiles, { id: 'u3', name: 'Eve', gear_owned: [] }],
    })
    renderPage()
    const people = await openSection(user, /^people/i)
    expect(within(people).getByRole('link', { name: /view Ada's profile/i })).toHaveAttribute('href', '/admin/users?diver=u1')
    const waitlist = within(people).getByRole('group', { name: /^waitlist$/i })
    expect(within(waitlist).getByRole('link', { name: /view Eve's profile/i })).toHaveAttribute('href', '/admin/users?diver=u3')
  })

  it('leaves names plain for staff, and for a booking with no profile', async () => {
    const user = userEvent.setup()
    useAuthMock.mockReturnValue({ profile: { id: 's-1', role: 'staff' } })
    mockDay({ profileRows: [profiles[0]] })
    renderPage()
    const people = await openSection(user, /^people/i)
    expect(within(people).getByText('Ada').closest('a')).toBeNull()
    expect(within(people).getByText('(no profile)').closest('a')).toBeNull()
  })
})

describe('AdminLogisticsPage — payments', () => {
  it('shows who still owes for the day — overall total plus a per-event list, covered divers flagged', async () => {
    const user = userEvent.setup()
    mockDay({
      bookingRows: [
        // Ada owes her full 3,200; Bo's 2,800 is covered by Ada, 1,000 paid.
        { id: 'b1', user_id: 'u1', payer_id: 'u1', event_id: 'e1', status: 'pending', details: { gear: { rent: false }, total: 3200 } },
        { id: 'b2', user_id: 'u2', payer_id: 'u1', event_id: 'e1', status: 'pending', details: { gear: { rent: false }, total: 2800 } },
      ],
      extra: { payments: [{ id: 'p1', booking_id: 'b2', amount: 1000, status: 'paid' }] },
    })
    renderPage()
    expect(await screen.findByRole('tab', { name: /^payments, 2 due/i })).toHaveTextContent('2')
    const pay = await openSection(user, /^payments/i)

    expect(within(pay).getByText(/2 divers still owe/i)).toHaveTextContent(/5,000 outstanding/i)
    const due = within(pay).getByRole('group', { name: /payments due/i })
    expect(within(due).getByText(/3,200 due/)).toBeInTheDocument()
    expect(within(due).getByText(/1,800 due/)).toBeInTheDocument()
    expect(within(due).getByText(/paid by Ada/i)).toBeInTheDocument()
  })

  it('nets discounts/surcharges and credit-funded payments into the balance, like the event page', async () => {
    const user = userEvent.setup()
    mockDay({
      bookingRows: [
        // Ada: 3,200 discounted by 700, settled with 2,500 of account credit.
        { id: 'b1', user_id: 'u1', payer_id: 'u1', event_id: 'e1', status: 'confirmed', details: { gear: { rent: false }, total: 3200 } },
        // Bo: 2,800 plus a 300 surcharge, 1,000 paid → 2,100 due.
        { id: 'b2', user_id: 'u2', payer_id: 'u2', event_id: 'e1', status: 'confirmed', details: { gear: { rent: false }, total: 2800 } },
      ],
      extra: {
        payments: [
          { id: 'p1', booking_id: 'b1', amount: 2500, status: 'paid', method: 'account_credit' },
          { id: 'p2', booking_id: 'b2', amount: 1000, status: 'paid', method: 'cash' },
        ],
        booking_amendments: [
          { id: 'a1', booking_id: 'b1', amount: -700, note: 'Loyalty discount', created_by: 'admin-1', created_at: '' },
          { id: 'a2', booking_id: 'b2', amount: 300,  note: 'Late nitrox add',  created_by: 'admin-1', created_at: '' },
        ],
      },
    })
    renderPage()
    const pay = await openSection(user, /^payments/i)
    expect(within(pay).getByText(/1 diver still owe/i)).toHaveTextContent(/2,100 outstanding/i)
    const due = within(pay).getByRole('group', { name: /payments due/i })
    expect(within(due).queryByText(/Ada/)).not.toBeInTheDocument()
  })

  it('says all settled, and lists no event, once everyone has paid', async () => {
    const user = userEvent.setup()
    mockDay({
      bookingRows: [{ id: 'b1', user_id: 'u1', payer_id: 'u1', event_id: 'e1', status: 'confirmed', details: { gear: { rent: false }, total: 1500 } }],
      extra: { booking_amendments: [{ id: 'a1', booking_id: 'b1', amount: -1500, note: 'Comped', created_by: 'admin-1', created_at: '' }] },
    })
    renderPage()
    const pay = await openSection(user, /^payments/i)
    expect(within(pay).getByText(/all settled/i)).toBeInTheDocument()
    expect(within(pay).queryByRole('group', { name: /payments due/i })).not.toBeInTheDocument()
  })
})

describe('AdminLogisticsPage — days', () => {
  it('refetches for a different day when a day tab is clicked', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()
    const firstDay = fetchEventsInRange.mock.calls[0][0] as string

    await user.click(screen.getByRole('tab', { name: /tomorrow/i }))
    await waitFor(() => expect(fetchEventsInRange.mock.calls.length).toBeGreaterThan(1))
    const laterDay = fetchEventsInRange.mock.calls.at(-1)![0] as string
    expect(laterDay > firstDay).toBe(true)
  })

  it('jumps to tomorrow from today when tomorrow is the next day with events', async () => {
    fetchUpcomingEventDays.mockResolvedValue([todayKey, tomorrowKey])
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(await screen.findByRole('button', { name: /next: tomorrow/i }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /tomorrow/i })).toHaveAttribute('aria-selected', 'true')
    })
    expect(fetchEventsInRange.mock.calls.at(-1)![0]).toBe(tomorrowKey)
  })

  it('skips dead days — the jump lands on the next day that actually has events', async () => {
    const farOff = dayKeyOffset(todayKey, 9)
    fetchUpcomingEventDays.mockResolvedValue([todayKey, farOff])
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(await screen.findByRole('button', { name: new RegExp(`next: ${farOff}`, 'i') }))
    await waitFor(() => expect(fetchEventsInRange.mock.calls.at(-1)![0]).toBe(farOff))
    expect(screen.getByRole('tab', { name: /other day/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('hides the jump button on the last day that has events', async () => {
    fetchUpcomingEventDays.mockResolvedValue([todayKey])
    renderPage()
    await loaded()
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
    await loaded()

    await user.click(screen.getByRole('tab', { name: /other day/i }))
    await user.selectOptions(await screen.findByRole('combobox', { name: /select a day/i }), '2026-07-15')
    await waitFor(() => {
      const last = fetchEventsInRange.mock.calls.at(-1)!
      expect(last[0]).toBe('2026-07-15')
      expect(last[1]).toBe('2026-07-15')
    })
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
    const user = userEvent.setup()
    renderOffline(offlineCtx({
      online: false,
      snapshot: {
        ...snapshotWith({ [todayKey]: storedBoard }),
        vehicles: [
          { id: 'v1', name: 'Shop van', passenger_seats: 7, active: true, created_at: '', created_by: null },
        ] as unknown as OfflineSnapshot['vehicles'],
      },
    }))
    await user.click(await screen.findByRole('tab', { name: /^rides/i }))
    // Without the stored fleet the planner reports an empty catalog and offers
    // no plan at all; with it, the seven seats are there to allocate.
    await waitFor(() =>
      expect(screen.queryByText(new RegExp(t.admin.transport.noFleetPrefix))).not.toBeInTheDocument())
  })

  it('reports an empty fleet when the device holds none either', async () => {
    const user = userEvent.setup()
    renderOffline(offlineCtx({ online: false, snapshot: snapshotWith({ [todayKey]: storedBoard }) }))
    await user.click(await screen.findByRole('tab', { name: /^rides/i }))
    expect(await screen.findByText(new RegExp(t.admin.transport.noFleetPrefix))).toBeInTheDocument()
  })
})
