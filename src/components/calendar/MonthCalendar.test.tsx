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
})
