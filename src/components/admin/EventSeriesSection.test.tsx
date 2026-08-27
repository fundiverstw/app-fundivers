import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { EventSeriesSection } from './EventSeriesSection'
import * as series from '../../lib/event-series'
import type { EventRow, EventSeries } from '../../types/database'

let role: 'admin' | 'staff' = 'admin'
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'a1' }, profile: { id: 'a1', role } }),
}))

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(), toastError: vi.fn(),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

const SERIES: EventSeries = {
  id: 's1', created_at: '', created_by: null, label: 'Saturday boat dives',
  kind: 'dive', freq: 'weekly', interval: 1, weekdays: [6],
}

const row = (id: string, date: string, over: Partial<EventRow> = {}): EventRow => ({
  id, kind: 'dive', start_date: date, end_date: null, course_days: null,
  series_id: 's1', cancelled_at: null, admin_title: 'Boat dive',
  ...over,
} as EventRow)

// Four Saturdays; the page is showing the second.
const OCCURRENCES = [
  row('e1', '2026-08-01'),
  row('e2', '2026-08-08'),
  row('e3', '2026-08-15'),
  row('e4', '2026-08-22'),
]

function renderAt(eventId = 'e2') {
  return render(
    <MemoryRouter>
      <EventSeriesSection eventId={eventId} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  role = 'admin'
  toastSuccess.mockReset()
  toastError.mockReset()
  vi.spyOn(series, 'fetchEventSeriesId').mockResolvedValue('s1')
  vi.spyOn(series, 'fetchSeries').mockResolvedValue(SERIES)
  vi.spyOn(series, 'fetchSeriesOccurrences').mockResolvedValue(OCCURRENCES)
})

describe('EventSeriesSection', () => {
  // A one-off event must not grow a Series panel.
  it('renders nothing when the event belongs to no series', async () => {
    vi.spyOn(series, 'fetchEventSeriesId').mockResolvedValue(null)
    const { container } = renderAt()
    await vi.waitFor(() => expect(series.fetchEventSeriesId).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('shows where this occurrence sits, the label and the pattern', async () => {
    renderAt()
    expect(await screen.findByText(/occurrence 2 of 4/i)).toBeInTheDocument()
    expect(screen.getByText(/saturday boat dives/i)).toBeInTheDocument()
    expect(screen.getByText(/repeats weekly on Sat/i)).toBeInTheDocument()
  })

  it('links every occurrence, marking the current one and the cancelled ones', async () => {
    vi.spyOn(series, 'fetchSeriesOccurrences').mockResolvedValue([
      ...OCCURRENCES.slice(0, 3),
      row('e4', '2026-08-22', { cancelled_at: '2026-07-01T00:00:00Z' }),
    ])
    renderAt()
    const links = await screen.findAllByRole('link')
    expect(links).toHaveLength(4)
    expect(links[1]).toHaveAttribute('href', '/admin/events/e2')
    expect(links[3].className).toContain('line-through')
  })

  // The counts are what tell an admin the blast radius before they act.
  it('offers the actions scoped to the occurrences after this one', async () => {
    renderAt()
    expect(await screen.findByRole('button', { name: /apply this event's settings to the next 2/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel the next 2/i })).toBeInTheDocument()
  })

  it('disables both bulk actions on the last occurrence', async () => {
    renderAt('e4')
    expect(await screen.findByRole('button', { name: /apply this event's settings/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /cancel the next/i })).toBeDisabled()
  })

  it('cancels the later occurrences after a confirm, and reports the credits', async () => {
    const cancel = vi.spyOn(series, 'cancelLaterOccurrences').mockResolvedValue({
      cancelled: 2, credited: 3, creditedAmount: 9000, stoppedBy: null,
    })
    window.confirm = vi.fn(() => true)
    const user = userEvent.setup()
    renderAt()

    await user.click(await screen.findByRole('button', { name: /cancel the next 2/i }))
    expect(cancel).toHaveBeenCalledWith({ seriesId: 's1', fromDate: '2026-08-08' })
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/cancelled 2/i))
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/credited 3/i))
  })

  it('does nothing when the cancel confirm is declined', async () => {
    const cancel = vi.spyOn(series, 'cancelLaterOccurrences')
    window.confirm = vi.fn(() => false)
    const user = userEvent.setup()
    renderAt()

    await user.click(await screen.findByRole('button', { name: /cancel the next 2/i }))
    expect(cancel).not.toHaveBeenCalled()
  })

  // Credits can no longer half-happen — they are written by the same
  // transaction as the cancel — but the run itself can still stop partway, and
  // the shop has to know where it got to.
  it('reports an early stop with the count that did land', async () => {
    vi.spyOn(series, 'cancelLaterOccurrences').mockResolvedValue({
      cancelled: 1, credited: 0, creditedAmount: 0, stoppedBy: new Error('nope'),
    })
    window.confirm = vi.fn(() => true)
    const user = userEvent.setup()
    renderAt()

    await user.click(await screen.findByRole('button', { name: /cancel the next 2/i }))
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/stopped after 1/i))
  })

  it('applies this occurrence to the later ones from the saved row', async () => {
    const apply = vi.spyOn(series, 'applyToLaterOccurrences').mockResolvedValue(2)
    window.confirm = vi.fn(() => true)
    const user = userEvent.setup()
    renderAt()

    await user.click(await screen.findByRole('button', { name: /apply this event's settings/i }))
    expect(apply).toHaveBeenCalledWith('s1', '2026-08-08', expect.objectContaining({ type: 'dive' }))
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/updated 2/i))
  })

  it('extends the series by the requested count', async () => {
    const extend = vi.spyOn(series, 'extendSeries')
      .mockResolvedValue({ eventIds: ['e5', 'e6'], dates: ['2026-08-29', '2026-09-05'] })
    const user = userEvent.setup()
    renderAt()

    const count = await screen.findByLabelText(/add more/i)
    await user.clear(count)
    await user.type(count, '2')
    await user.click(screen.getByRole('button', { name: /add to series/i }))

    expect(extend).toHaveBeenCalledWith('s1', 2, expect.any(Function))
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/added 2/i))
  })

  it('refuses an out-of-range extend count without calling the server', async () => {
    const extend = vi.spyOn(series, 'extendSeries')
    const user = userEvent.setup()
    renderAt()

    const count = await screen.findByLabelText(/add more/i)
    await user.clear(count)
    await user.type(count, '999')
    await user.click(screen.getByRole('button', { name: /add to series/i }))

    expect(extend).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/between 1 and 52/i))
  })

  // Staff read the admin event pages; only admins may rewrite a batch.
  it('shows the series to staff but none of the actions', async () => {
    role = 'staff'
    renderAt()
    expect(await screen.findByText(/occurrence 2 of 4/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
