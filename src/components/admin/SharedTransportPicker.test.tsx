import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SharedTransportPicker } from './SharedTransportPicker'

const events = [
  { id: 'e1', title: 'Bat Cave' },
  { id: 'e2', title: 'Refresher Course' },
]

function setup(over: Partial<React.ComponentProps<typeof SharedTransportPicker>> = {}) {
  const onShareWith = vi.fn()
  const onRideAlone = vi.fn()
  const r = render(
    <SharedTransportPicker
      events={events}
      groupOf={new Map()}
      isAdmin
      busy={false}
      onShareWith={onShareWith}
      onRideAlone={onRideAlone}
      {...over}
    />,
  )
  return { onShareWith, onRideAlone, ...r }
}

describe('SharedTransportPicker', () => {
  it('renders nothing when the day has only one event — nothing to share with', () => {
    const { container } = setup({ events: [events[0]] })
    expect(container).toBeEmptyDOMElement()
  })

  it('defaults every event to riding alone', () => {
    setup()
    expect(screen.getByLabelText(/Shared transport for Bat Cave/i)).toHaveValue('')
    expect(screen.getAllByRole('option', { name: 'Rides alone' })).toHaveLength(2)
  })

  it('offers the other events as ride partners and reports the pick', async () => {
    const { onShareWith } = setup()
    await userEvent.selectOptions(
      screen.getByLabelText(/Shared transport for Bat Cave/i),
      'e2',
    )
    expect(onShareWith).toHaveBeenCalledWith('e1', 'e2')
    // An event is never offered itself.
    expect(screen.queryByRole('option', { name: 'Rides with Bat Cave' })).toBeInTheDocument()
  })

  it('shows a grouped event as riding with its partner, and can send it back alone', async () => {
    const grouped = new Map([['e1', 'g1'], ['e2', 'g1']])
    const { onRideAlone } = setup({ groupOf: grouped })
    const select = screen.getByLabelText(/Shared transport for Bat Cave/i)
    expect(select).toHaveValue('e2')
    await userEvent.selectOptions(select, '')
    expect(onRideAlone).toHaveBeenCalledWith('e1')
  })

  it('for staff shows the grouping as text, with no controls', () => {
    setup({ isAdmin: false, groupOf: new Map([['e1', 'g1'], ['e2', 'g1']]) })
    expect(screen.getByText('Bat Cave + Refresher Course')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('for staff renders nothing when no events are grouped', () => {
    const { container } = render(
      <SharedTransportPicker
        events={events}
        groupOf={new Map()}
        isAdmin={false}
        busy={false}
        onShareWith={() => {}}
        onRideAlone={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables the pickers while a change is in flight', () => {
    setup({ busy: true })
    expect(screen.getByLabelText(/Shared transport for Bat Cave/i)).toBeDisabled()
  })
})
