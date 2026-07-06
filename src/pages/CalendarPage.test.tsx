import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarPage } from './CalendarPage'
import { renderWithRouter, mockQueryBuilder } from '../../tests/test-utils'
import type { AppEvent } from '../types/database'

const { from, insert, update, invoke, useAuthMock, fetchEventsInRange } = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsInRange: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

vi.mock('../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../lib/events')>('../lib/events')
  return {
    ...actual,
    fetchEventsInRange: (...a: unknown[]) => fetchEventsInRange(...a),
  }
})

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}))

// Pin the clock to a stable mid-month date. The calendar grid renders
// only the current month's days, so `future(7)` has to land within the
// same month — without pinning, tests break whenever the real clock is
// within a week of month-end (Apr 24+ pushed future events into May and
// off the April grid).
beforeAll(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); vi.setSystemTime(new Date('2026-06-15T00:00:00Z')) })
afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
  from.mockReset()
  insert.mockReset()
  update.mockReset()
  invoke.mockReset()
  fetchEventsInRange.mockReset()
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'u1' } })
})

function future(daysAhead = 7) {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString()
}

function buildEvent(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: overrides.id ?? 'dive_a1',
    type: overrides.type ?? 'dive',
    title: overrides.title ?? 'Green Island Dive',
    course_category: overrides.course_category,
    start_time: overrides.start_time ?? future(),
    end_time: overrides.end_time ?? null,
    featured: overrides.featured ?? false,
    fully_booked: overrides.fully_booked ?? false,
    price: overrides.price ?? 1500,
    currency: overrides.currency ?? 'TWD',
  }
}

function setupBookings(bookings: unknown[], inserted?: unknown) {
  from.mockImplementation(() => ({
    ...mockQueryBuilder({ data: bookings }),
    insert: (...a: unknown[]) => {
      insert(...a)
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted ?? null, error: null }),
        }),
      }
    },
    update: (...a: unknown[]) => {
      update(...a)
      return mockQueryBuilder({ data: null })
    },
  }))
}

describe('CalendarPage', () => {
  it('shows an empty state when there are no events', async () => {
    fetchEventsInRange.mockResolvedValue([])
    setupBookings([])
    renderWithRouter(<CalendarPage />)
    expect(await screen.findByText(/no events scheduled/i)).toBeInTheDocument()
  })

  it('renders events with a type badge', async () => {
    fetchEventsInRange.mockResolvedValue([buildEvent({ title: 'Beginner Course', type: 'course' })])
    setupBookings([])
    renderWithRouter(<CalendarPage />)
    // Title appears on both the calendar bar and the "This month" list
    const matches = await screen.findAllByText('Beginner Course')
    expect(matches.length).toBeGreaterThanOrEqual(1)
    // List row badge says "Course"; legend chip says "Courses"
    expect(screen.getByText('Course')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /filter courses/i })).toBeInTheDocument()
  })

  it('tags events the current user has booked', async () => {
    const ev = buildEvent({ id: 'dive_a1', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([{ id: 'b1', user_id: 'u1', event_id: 'dive_a1', status: 'confirmed' }])
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    expect(screen.getByText(/^booked$/i)).toBeInTheDocument()
  })

  it('opens the detail modal on click', async () => {
    const ev = buildEvent()
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
    expect(await screen.findByRole('button', { name: 'Register' })).toBeInTheDocument()
    expect(screen.getByText(/TWD\s*1,500/)).toBeInTheDocument()
  })

  it('Register opens the multi-step register form', async () => {
    const ev = buildEvent({ id: 'dive_xyz', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([])

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
    await user.click(screen.getByRole('button', { name: 'Register' }))

    expect(await screen.findByText(/step 1 of 4/i)).toBeInTheDocument()
    // The event detail modal closes; only the register form is now visible.
    expect(screen.queryByRole('button', { name: /^register$/i })).not.toBeInTheDocument()
  })

  it('Cancel booking updates status to cancelled', async () => {
    const ev = buildEvent({ id: 'dive_xyz', type: 'dive' })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([{ id: 'b1', user_id: 'u1', event_id: 'dive_xyz', status: 'confirmed' }])

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
    await user.click(screen.getByRole('button', { name: /cancel booking/i }))

    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    expect(update.mock.calls[0][0]).toEqual({ status: 'cancelled' })
  })

  it('disables Register for a fully-booked event', async () => {
    const ev = buildEvent({ fully_booked: true })
    fetchEventsInRange.mockResolvedValue([ev])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText(ev.title)
    // The title now appears twice (calendar bar + list row); click the first.
    await user.click(screen.getAllByText(ev.title)[0])
    // The list row's accessible name now contains "register for waitlist",
    // so match on exact "Register" to grab the action button instead.
    const btn = await screen.findByRole('button', { name: 'Register' })
    expect(btn).toBeDisabled()
  })

  it('toggling Dive off hides dive events from the month list', async () => {
    fetchEventsInRange.mockResolvedValue([
      buildEvent({ id: 'dive_a', type: 'dive', title: 'Green Island Dive' }),
      buildEvent({ id: 'course_a', type: 'course', title: 'Open Water Course' }),
    ])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    // Title shows on the bar + list row = 2 matches when visible
    await waitFor(() => {
      expect(screen.getAllByText('Green Island Dive').length).toBeGreaterThanOrEqual(2)
      expect(screen.getAllByText('Open Water Course').length).toBeGreaterThanOrEqual(2)
    })

    await user.click(screen.getByRole('button', { name: /toggle dives/i }))

    expect(screen.queryByText('Green Island Dive')).not.toBeInTheDocument()
    // Course is unaffected
    expect(screen.getAllByText('Open Water Course').length).toBeGreaterThanOrEqual(2)
  })

  it('course popover filters by category (OW / AOW)', async () => {
    fetchEventsInRange.mockResolvedValue([
      buildEvent({ id: 'ow_1', type: 'course', title: 'Open Water Course', course_category: 'OW' }),
      buildEvent({ id: 'aow_1', type: 'course', title: 'Advanced Open Water', course_category: 'AOW' }),
    ])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await waitFor(() => {
      expect(screen.getAllByText('Open Water Course').length).toBeGreaterThanOrEqual(2)
      expect(screen.getAllByText('Advanced Open Water').length).toBeGreaterThanOrEqual(2)
    })

    // Popover is closed by default
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /filter courses/i }))
    const menu = await screen.findByRole('menu')
    // Short label "OW" identifies the checkbox in the popover
    const owChip = within(menu).getByRole('checkbox', { name: /^OW\b/i })
    const aowChip = within(menu).getByRole('checkbox', { name: /^AOW\b/i })
    expect(owChip).toBeChecked()
    expect(aowChip).toBeChecked()

    // Uncheck OW → the OW event disappears from the calendar bar and list
    // row. The popover labels by category ("OW"), not the diver-facing title,
    // so "Open Water Course" is gone entirely.
    await user.click(owChip)
    expect(screen.queryByText('Open Water Course')).not.toBeInTheDocument()
    expect(screen.getAllByText('Advanced Open Water').length).toBeGreaterThanOrEqual(2)

    // Popover still open, AOW still checked
    expect(menu).toBeInTheDocument()
    expect(aowChip).toBeChecked()
  })

  it('advances the month with the arrow buttons', async () => {
    fetchEventsInRange.mockResolvedValue([])
    setupBookings([])
    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    const heading = await screen.findByRole('heading', { level: 1 })
    const initial = heading.textContent
    await user.click(screen.getByRole('button', { name: /next month/i }))
    await waitFor(() => expect(heading.textContent).not.toBe(initial))
  })

  it('multi-event registration: cart submits one create-registration call per event with a shared group_id', async () => {
    const evA = buildEvent({ id: 'dive_aa', type: 'dive', title: 'Green Island Dive' })
    const evB = buildEvent({ id: 'dive_bb', type: 'dive', title: 'Long Dong Bay' })
    fetchEventsInRange.mockResolvedValue([evA, evB])
    setupBookings([])
    useAuthMock.mockReturnValue({
      user:    { id: 'u1' },
      profile: {
        id: 'u1', name: 'Ada Lovelace', nationality: 'British', gender: 'female',
        contact_method: null, contact_id: null,
        cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false, deep_certified: false,
        emergency_contact_name: null, emergency_contact_phone: null,
      },
    })
    invoke.mockResolvedValueOnce({ data: { booking_id: 'bA', status: 'pending' }, error: null })
    invoke.mockResolvedValueOnce({ data: { booking_id: 'bB', status: 'pending' }, error: null })

    const user = userEvent.setup()
    renderWithRouter(<CalendarPage />)
    await screen.findAllByText('Green Island Dive')

    // Enter multi mode and add both events from the "this month" list.
    await user.click(screen.getByRole('button', { name: /register for multiple events/i }))
    const addButtons = await screen.findAllByText('+ Add')
    expect(addButtons.length).toBeGreaterThanOrEqual(2)
    // Click the row, not the badge — the list item is the click target.
    await user.click(addButtons[0].closest('li,div,button,article,a') ?? addButtons[0])
    await user.click(addButtons[1].closest('li,div,button,article,a') ?? addButtons[1])

    // Floating cart bar shows count, Continue advances to the modal.
    expect(await screen.findByText(/2 events selected/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /continue/i }))

    // Walk steps 1 → 2 → 3 → 4 and submit. Scope queries to the modal so
    // the calendar's "Next month" button doesn't shadow the form's "Next".
    const dialog = await screen.findByRole('dialog', { name: /multi-event registration/i })
    await user.click(within(dialog).getByRole('button', { name: /next/i }))                    // step 1 → 2
    await user.click(within(dialog).getByRole('button', { name: /next/i }))                    // step 2 → 3
    const noTransportRadios = within(dialog).getAllByRole('radio', { name: /i'll get there myself/i })
    expect(noTransportRadios.length).toBe(2)
    for (const r of noTransportRadios) await user.click(r)
    await user.click(within(dialog).getByRole('button', { name: /next/i }))                    // step 3 → 4
    await user.click(within(dialog).getByRole('button', { name: /confirm 2 bookings/i }))      // submit

    // Two create-registration calls (one per cart event) plus one
    // consolidated group summary now that the cart is a multi-booking group.
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
    const regCalls = invoke.mock.calls.filter(c => c[0] === 'create-registration')
    expect(regCalls).toHaveLength(2)
    const firstBody  = (regCalls[0][1] as { body: Record<string, unknown> }).body
    const secondBody = (regCalls[1][1] as { body: Record<string, unknown> }).body
    // Both calls share the same group_id — that's the whole point of the cart.
    expect(firstBody.group_id).toBeDefined()
    expect(firstBody.group_id).toEqual(secondBody.group_id)
    expect([firstBody.event_id, secondBody.event_id].sort()).toEqual(['dive_aa', 'dive_bb'])
    // The group summary targets that shared group_id.
    const summaryCall = invoke.mock.calls.find(c => c[0] === 'send-group-summary')!
    expect((summaryCall[1] as { body: { group_id: string } }).body.group_id).toEqual(firstBody.group_id)
  })
})
