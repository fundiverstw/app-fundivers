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

  it('renders Open Water Course bars in sky-blue (OW bucket)', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[makeCourse('c-ow', 'Open Water Course')]}
        onPickEvent={() => {}}
      />
    )
    const bar = screen.getByTitle('Open Water Course')
    expect(bar.className).toMatch(/bg-sky/)
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
    expect(bar.className).not.toMatch(/bg-sky/)
  })

  it('renders Rescue / EFR / Deep specialty courses in pink', () => {
    render(
      <MonthCalendar
        month={new Date('2030-06-15')}
        onMonthChange={() => {}}
        events={[
          makeCourse('c-rescue', 'PADI Rescue Course'),
          makeCourse('c-efr',    'EFR Course'),
          makeCourse('c-deep',   'Deep Specialty'),
        ]}
        onPickEvent={() => {}}
      />
    )
    for (const t of ['PADI Rescue Course', 'EFR Course', 'Deep Specialty']) {
      const bar = screen.getByTitle(t)
      expect(bar.className).toMatch(/bg-pink/)
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
