import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MonthCalendar } from './MonthCalendar'
import type { StaffBusyEntry } from '../../types/database'

const busy: StaffBusyEntry = {
  id: 'b1',
  user_id: 'u1',
  start_date: '2030-06-10',
  start_time: '09:00:00',
  end_date:   '2030-06-12',
  title: 'Out diving',
  details: null,
  owner_display_name: 'Ada',
  created_at: '2030-01-01T00:00:00Z',
  updated_at: '2030-01-01T00:00:00Z',
}

// Same row but as a non-owner would see it through the view: title +
// details masked to null; owner_display_name still present.
const maskedBusy: StaffBusyEntry = {
  ...busy,
  title: null,
  details: null,
}

describe('MonthCalendar staff-busy overlay', () => {
  it('omits the Busy toggle when busyEntries is undefined', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: /toggle staff availability/i })).not.toBeInTheDocument()
  })

  it('shows the Busy toggle when busyEntries + onToggleBusy are provided', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
        busyEntries={[]}
        busyShown={false}
        onToggleBusy={() => {}}
      />
    )
    expect(screen.getByRole('button', { name: /toggle staff availability/i })).toBeInTheDocument()
  })

  it('renders no busy bar when busyShown=false, and fires onToggleBusy when clicked', async () => {
    const onToggleBusy = vi.fn()
    const user = userEvent.setup()
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
        busyEntries={[busy]}
        busyShown={false}
        onToggleBusy={onToggleBusy}
        currentUserId="u1"
      />
    )
    expect(screen.queryByTitle('Out diving')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /toggle staff availability/i }))
    expect(onToggleBusy).toHaveBeenCalledTimes(1)
  })

  it('renders busy bars immediately when busyShown=true', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
        busyEntries={[busy]}
        busyShown
        onToggleBusy={() => {}}
        currentUserId="u1"
      />
    )
    expect(screen.getAllByTitle('Out diving').length).toBeGreaterThan(0)
  })

  it('clicking a busy bar fires onPickBusy with the underlying row', async () => {
    const onPickBusy = vi.fn()
    const user = userEvent.setup()
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
        busyEntries={[busy]}
        busyShown
        onToggleBusy={() => {}}
        currentUserId="u1"
        onPickBusy={onPickBusy}
      />
    )
    await user.click(screen.getAllByTitle('Out diving')[0])
    expect(onPickBusy).toHaveBeenCalledWith(busy)
  })

  it("renders the owner's name (not the masked title) on a non-own busy bar", () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
        busyEntries={[maskedBusy]}
        busyShown
        onToggleBusy={() => {}}
        currentUserId="someone-else"
      />
    )
    expect(screen.getAllByTitle('Ada').length).toBeGreaterThan(0)
    expect(screen.queryByTitle('Out diving')).not.toBeInTheDocument()
  })

  it('overlays a violet duty stripe on a day the viewer is on duty for, leaving the base type color underneath', () => {
    const ev = {
      id: 'D1', type: 'dive' as const, title: 'Reef trip',
      calendar_title: null,
      start_time: '2030-06-12T09:00:00',
      end_time:   '2030-06-12T15:00:00',
      start_time_hhmm: '09:00',
      featured: false, fully_booked: false,
      capacity: null, confirmed_count: null,
      price: null, deposit_amount: null, transport_price: null, currency: 'TWD',
      has_rooms: false, room_type_ids: [],
      has_addons: false, addon_ids: [],
      gear_rental_info: null, nitrox_required: false, dive_days: null,
      cancelled_at: null,
    }
    const { rerender } = render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[ev]}
        onPickEvent={() => {}}
      />
    )
    // Without ownDutyDays the bar is plain emerald with no overlay.
    const plain = screen.getByTitle('Reef trip')
    expect(plain.className).toMatch(/bg-emerald/)
    expect(plain.getAttribute('style') ?? '').not.toMatch(/repeating-linear-gradient/)

    // With ownDutyDays containing this day, the bar keeps its emerald
    // base and adds a violet stripe overlay. Stripe color must be violet
    // (#7c3aed), not amber — the old amber would clash with the new
    // AOW-orange course bars.
    rerender(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[ev]}
        onPickEvent={() => {}}
        ownDutyDays={new Map([['D1', new Set(['2030-06-12'])]])}
      />
    )
    const tinted = screen.getByTitle('Reef trip')
    expect(tinted.className).toMatch(/bg-emerald/)
    const style = tinted.getAttribute('style') ?? ''
    expect(style).toMatch(/repeating-linear-gradient/)
    expect(style).toMatch(/#7c3aed/i)
  })

  it('only stripes the specific duty day on a multi-day event', () => {
    const ev = {
      id: 'D1', type: 'dive' as const, title: 'Reef trip',
      calendar_title: null,
      start_time: '2030-06-10T09:00:00',
      end_time:   '2030-06-12T15:00:00',
      start_time_hhmm: '09:00',
      featured: false, fully_booked: false,
      capacity: null, confirmed_count: null,
      price: null, deposit_amount: null, transport_price: null, currency: 'TWD',
      has_rooms: false, room_type_ids: [],
      has_addons: false, addon_ids: [],
      gear_rental_info: null, nitrox_required: false, dive_days: null,
      cancelled_at: null,
    }
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[ev]}
        onPickEvent={() => {}}
        ownDutyDays={new Map([['D1', new Set(['2030-06-11'])]])}
      />
    )
    // Three day-segments rendered for the three-day event; exactly one
    // (2030-06-11) carries the stripe overlay.
    const bars = screen.getAllByTitle('Reef trip')
    expect(bars).toHaveLength(3)
    const striped = bars.filter(b =>
      (b.getAttribute('style') ?? '').includes('repeating-linear-gradient'),
    )
    expect(striped).toHaveLength(1)
  })

  it('clicking an empty cell fires onCreateBusy with that day', async () => {
    const onCreateBusy = vi.fn()
    const user = userEvent.setup()
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
        busyEntries={[]}
        busyShown
        onToggleBusy={() => {}}
        onCreateBusy={onCreateBusy}
      />
    )
    // The day-number "1" appears inside the first day cell. Click that
    // cell's clickable wrapper by tapping the number's container.
    const dayNumber = screen.getAllByText('1')[0]
    await user.click(dayNumber)
    expect(onCreateBusy).toHaveBeenCalledTimes(1)
    const calledWith = onCreateBusy.mock.calls[0][0] as Date
    expect(calledWith.getDate()).toBe(1)
    expect(calledWith.getMonth()).toBe(5) // June (0-indexed)
  })

  it("uses violet (not amber) for the viewer's own-busy bars so they don't clash with AOW-orange courses", () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[]}
        onPickEvent={() => {}}
        busyEntries={[busy]}
        busyShown
        onToggleBusy={() => {}}
        currentUserId="u1"
      />
    )
    const bars = screen.getAllByTitle('Out diving')
    expect(bars.length).toBeGreaterThan(0)
    for (const b of bars) {
      expect(b.className).toMatch(/bg-violet/)
      expect(b.className).not.toMatch(/bg-amber/)
    }
  })
})

describe('MonthCalendar course color buckets', () => {
  function makeCourse(id: string, title: string) {
    return {
      id, type: 'course' as const, title, calendar_title: null,
      start_time: '2030-06-12T09:00:00',
      end_time:   '2030-06-12T15:00:00',
      start_time_hhmm: '09:00',
      featured: false, fully_booked: false,
      capacity: null, confirmed_count: null,
      price: null, deposit_amount: null, transport_price: null, currency: 'TWD' as const,
      has_rooms: false, room_type_ids: [] as string[],
      has_addons: false, addon_ids: [] as string[],
      gear_rental_info: null, nitrox_required: false, dive_days: null,
      cancelled_at: null,
    }
  }

  it('renders Open Water Course bars in blue (OW bucket)', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[makeCourse('c-ow', 'Open Water Course')]}
        onPickEvent={() => {}}
      />
    )
    const bar = screen.getByTitle('Open Water Course')
    expect(bar.className).toMatch(/bg-blue/)
  })

  it('renders Advanced Open Water bars in orange (AOW bucket)', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[makeCourse('c-aow', 'Advanced Open Water')]}
        onPickEvent={() => {}}
      />
    )
    const bar = screen.getByTitle('Advanced Open Water')
    expect(bar.className).toMatch(/bg-orange/)
    expect(bar.className).not.toMatch(/bg-blue/)
  })

  it('renders Rescue / EFR / O2 Provider courses in red', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[
          makeCourse('c-rescue', 'PADI Rescue Course'),
          makeCourse('c-efr',    'EFR Course'),
          makeCourse('c-o2',     'O2 Provider'),
        ]}
        onPickEvent={() => {}}
      />
    )
    for (const t of ['PADI Rescue Course', 'EFR Course', 'O2 Provider']) {
      const bar = screen.getByTitle(t)
      expect(bar.className).toMatch(/bg-red/)
    }
  })

  it('renders other specialty courses (Deep, Nitrox, ...) in purple', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[
          makeCourse('c-deep',   'Deep Specialty'),
          makeCourse('c-nitrox', 'Nitrox Course'),
        ]}
        onPickEvent={() => {}}
      />
    )
    for (const t of ['Deep Specialty', 'Nitrox Course']) {
      const bar = screen.getByTitle(t)
      expect(bar.className).toMatch(/bg-purple/)
    }
  })

  it('classifies titles correctly even with a capacity suffix appended', () => {
    // display_title_capacity_suffix trigger appends "(2 spots open)" /
    // "(fully booked -- register for waitlist)" — the color bucket must
    // still resolve to AOW.
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[makeCourse('c-aow-suffix', 'Advanced Open Water (2 spots open)')]}
        onPickEvent={() => {}}
      />
    )
    const bar = screen.getByTitle('Advanced Open Water (2 spots open)')
    expect(bar.className).toMatch(/bg-orange/)
  })
})

describe('MonthCalendar dive color buckets', () => {
  function makeDive(id: string, title: string, dive_outing?: 'local' | 'trip' | null) {
    return {
      id, type: 'dive' as const, title, calendar_title: null,
      start_time: '2030-06-12T09:00:00',
      end_time:   '2030-06-12T15:00:00',
      start_time_hhmm: '09:00',
      featured: false, fully_booked: false,
      capacity: null, confirmed_count: null,
      price: null, deposit_amount: null, transport_price: null, currency: 'TWD' as const,
      has_rooms: false, room_type_ids: [] as string[],
      has_addons: false, addon_ids: [] as string[],
      gear_rental_info: null, nitrox_required: false, dive_days: null,
      cancelled_at: null, dive_outing,
    }
  }

  function renderDive(dive: ReturnType<typeof makeDive>) {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[dive]}
        onPickEvent={() => {}}
      />
    )
    return screen.getByTitle(dive.title)
  }

  it('colors a local Northeast shore dive green', () => {
    expect(renderDive(makeDive('d1', '3 Day Dives at Long Dong Bay', 'local')).className).toMatch(/bg-emerald/)
  })

  it('colors a tagged trip/boat dive yellow', () => {
    expect(renderDive(makeDive('d2', 'Quiet shore dive', 'trip')).className).toMatch(/bg-yellow/)
  })

  it('falls back to the title when no destination is tagged', () => {
    expect(renderDive(makeDive('d3', 'Boat Dives Cathedral', null)).className).toMatch(/bg-yellow/)
    expect(renderDive(makeDive('d4', 'Seven Star in Kenting')).className).toMatch(/bg-yellow/)
    expect(renderDive(makeDive('d5', 'Fun Diving at Batcave', null)).className).toMatch(/bg-emerald/)
  })

  it('lets a tagged local override a boat-sounding title', () => {
    expect(renderDive(makeDive('d6', 'Boat Dives Cathedral', 'local')).className).toMatch(/bg-emerald/)
  })
})

describe('MonthCalendar private dives', () => {
  const baseDive = {
    id: 'P1', type: 'dive' as const, title: 'Charter dive',
    calendar_title: null,
    start_time: '2030-06-12T09:00:00', end_time: '2030-06-12T15:00:00',
    start_time_hhmm: '09:00',
    featured: false, fully_booked: false, capacity: null, confirmed_count: null,
    price: null, deposit_amount: null, transport_price: null, currency: 'TWD',
    has_rooms: false, room_type_ids: [], has_addons: false, addon_ids: [],
    gear_rental_info: null, nitrox_required: false, dive_days: null,
    cancelled_at: null, full_payment_deadline: null, cancel_policy: null, cancel_date: null,
  }

  it('flags a private dive with the closed-eye "Private" indicator', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[{ ...baseDive, is_private: true }]}
        onPickEvent={() => {}}
      />
    )
    // The eye-off icon appears (both the month grid bar and the list row).
    expect(screen.getAllByLabelText('Private').length).toBeGreaterThan(0)
  })

  it('does not flag a normal dive', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[{ ...baseDive, is_private: false }]}
        onPickEvent={() => {}}
      />
    )
    expect(screen.queryByLabelText('Private')).not.toBeInTheDocument()
  })
})
