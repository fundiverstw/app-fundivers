import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecurrenceFields } from './RecurrenceFields'

// 2026-08-01 is a Saturday.
const SAT = '2026-08-01'

function lastRule(onChange: ReturnType<typeof vi.fn>) {
  return onChange.mock.calls[onChange.mock.calls.length - 1]?.[0]
}

describe('RecurrenceFields', () => {
  it('says what it needs when the event has no date yet', () => {
    const onChange = vi.fn()
    render(<RecurrenceFields anchor={null} onChange={onChange} />)
    expect(screen.getByText(/give the event a date first/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('reports no rule until repeating is switched on', () => {
    const onChange = vi.fn()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)
    expect(lastRule(onChange)).toBeNull()
    expect(screen.queryByLabelText(/pattern/i)).not.toBeInTheDocument()
  })

  it('reports a weekly rule and previews the actual dates', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)

    await user.click(screen.getByRole('checkbox'))
    expect(lastRule(onChange)).toEqual(
      expect.objectContaining({ freq: 'weekly', interval: 1, count: 4, weekdays: [6] }),
    )
    // The dates themselves, since these become real bookable events.
    expect(screen.getByText(/4 events will be created/i)).toBeInTheDocument()
    expect(screen.getByText('Sat 1 Aug')).toBeInTheDocument()
    expect(screen.getByText('Sat 22 Aug')).toBeInTheDocument()
  })

  // The anchor's own weekday is occurrence #1 whatever the admin ticks, so the
  // control says so rather than letting them create a series the event isn't in.
  it('locks the anchor weekday on', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))

    const sat = screen.getByRole('button', { name: 'Sat' })
    expect(sat).toBeDisabled()
    expect(sat).toHaveAttribute('aria-pressed', 'true')
  })

  it('adds a second weekday to the pattern', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Sun' }))

    expect(lastRule(onChange).weekdays).toEqual([6, 7])
    expect(screen.getByText('Sun 2 Aug')).toBeInTheDocument()
  })

  it('describes a monthly pattern in words, derived from the anchor', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    // 2026-08-30 is the last Sunday of August.
    render(<RecurrenceFields anchor="2026-08-30" onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))
    await user.selectOptions(screen.getByLabelText(/pattern/i), 'monthly_weekday')

    expect(screen.getByText(/repeats on the last Sunday of the month/i)).toBeInTheDocument()
    expect(lastRule(onChange)).toEqual(expect.objectContaining({ freq: 'monthly_weekday' }))
    // A monthly rule carries no weekdays — the position is derived from the anchor.
    expect(lastRule(onChange).weekdays).toBeUndefined()
  })

  it('withholds the rule and explains why when the count is out of range', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))

    const count = screen.getByLabelText(/how many/i)
    await user.clear(count)
    await user.type(count, '99')

    expect(screen.getByText(/between 2 and 52 occurrences/i)).toBeInTheDocument()
    expect(lastRule(onChange)).toBeNull()
    expect(screen.queryByText(/events will be created/i)).not.toBeInTheDocument()
  })

  it('withholds the rule for an out-of-range interval', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))

    const interval = screen.getByLabelText(/every n weeks/i)
    await user.clear(interval)
    await user.type(interval, '0')

    expect(screen.getByText(/repeat every 1 to 12/i)).toBeInTheDocument()
    expect(lastRule(onChange)).toBeNull()
  })

  it('passes the series label up alongside the rule', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))
    await user.type(screen.getByLabelText(/series name/i), 'Saturday boat dives')

    const call = onChange.mock.calls[onChange.mock.calls.length - 1]
    expect(call[1]).toBe('Saturday boat dives')
  })

  it('drops the rule again when repeating is switched back off', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<RecurrenceFields anchor={SAT} onChange={onChange} />)
    await user.click(screen.getByRole('checkbox'))
    expect(lastRule(onChange)).not.toBeNull()
    await user.click(screen.getByRole('checkbox'))
    expect(lastRule(onChange)).toBeNull()
  })
})
