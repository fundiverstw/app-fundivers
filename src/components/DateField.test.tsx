import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DateField } from './DateField'

// Controlled wrapper mirroring how forms use DateField.
function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      value={value}
      onChange={v => { setValue(v); onValue?.(v) }}
      aria-label="Date"
    />
  )
}

describe('DateField', () => {
  it('lets the user type a date, auto-masking digits into YYYY-MM-DD', async () => {
    const onValue = vi.fn()
    const user = userEvent.setup()
    render(<Harness onValue={onValue} />)

    const input = screen.getByLabelText('Date')
    await user.type(input, '19870512')

    expect(input).toHaveValue('1987-05-12')
    // Only emits upstream once the typed value is a complete, valid date.
    expect(onValue).toHaveBeenLastCalledWith('1987-05-12')
  })

  it('emits "" while the entry is incomplete', async () => {
    const onValue = vi.fn()
    const user = userEvent.setup()
    render(<Harness onValue={onValue} />)

    await user.type(screen.getByLabelText('Date'), '1987')
    expect(onValue).toHaveBeenLastCalledWith('')
  })

  it('shows the controlled value and offers the calendar affordance', () => {
    render(<DateField value="2001-09-29" onChange={() => {}} aria-label="DOB" />)
    expect(screen.getByLabelText('DOB')).toHaveValue('2001-09-29')
    // The affordance is a real native date input overlaying the icon, so a tap
    // opens the OS picker without going through showPicker().
    const picker = screen.getByLabelText(/open calendar/i)
    expect(picker).toHaveAttribute('type', 'date')
    expect(picker).toHaveValue('2001-09-29')
  })

  it('keeps the native picker out of the tab order and off the labelled control', () => {
    // How the forms associate a label: by id, not by wrapping. A wrapping
    // <label> would claim the overlay input as well as the typeable one.
    render(
      <div>
        <label htmlFor="dob">DOB</label>
        <DateField id="dob" value="" onChange={() => {}} />
      </div>
    )
    expect(screen.getByLabelText('DOB')).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText(/open calendar/i)).toHaveAttribute('tabindex', '-1')
  })

  it('feeds the native picker an empty value when the entry is incomplete', () => {
    // A native date input rejects a partial 'YYYY-MM-DD', so a half-typed
    // entry must reach it as '' rather than as invalid markup.
    render(<DateField value="" onChange={() => {}} aria-label="DOB" />)
    expect(screen.getByLabelText(/open calendar/i)).toHaveValue('')
  })

  it('mirrors a calendar-picked date into the text field immediately, even while it holds focus', async () => {
    const onValue = vi.fn()
    const user = userEvent.setup()
    render(<Harness onValue={onValue} />)

    const input = screen.getByLabelText('Date')
    // Focus the text field first: the mirror effect's focus guard must not
    // hold the display stale after a pick.
    await user.click(input)
    fireEvent.change(screen.getByLabelText(/open calendar/i), { target: { value: '2010-03-04' } })

    expect(input).toHaveValue('2010-03-04')
    expect(onValue).toHaveBeenLastCalledWith('2010-03-04')
  })

  it('asks for the picker on click, for desktop browsers that only open from the indicator', async () => {
    const proto = HTMLInputElement.prototype as unknown as { showPicker?: () => void }
    const origShowPicker = proto.showPicker
    const showPicker = vi.fn()
    proto.showPicker = showPicker
    try {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByLabelText(/open calendar/i))
      expect(showPicker).toHaveBeenCalled()
    } finally {
      proto.showPicker = origShowPicker
    }
  })

  it('survives a browser with no showPicker at all — the tap alone opens the picker', async () => {
    const proto = HTMLInputElement.prototype as unknown as { showPicker?: () => void }
    const origShowPicker = proto.showPicker
    // @ts-expect-error deliberately modelling a browser without the API
    delete proto.showPicker
    try {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByLabelText(/open calendar/i))
      fireEvent.change(screen.getByLabelText(/open calendar/i), { target: { value: '2010-03-04' } })
      expect(screen.getByLabelText('Date')).toHaveValue('2010-03-04')
    } finally {
      proto.showPicker = origShowPicker
    }
  })

  it('throwing showPicker does not break the field', async () => {
    const proto = HTMLInputElement.prototype as unknown as { showPicker?: () => void }
    const origShowPicker = proto.showPicker
    proto.showPicker = vi.fn(() => { throw new Error('NotAllowedError') })
    try {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByLabelText(/open calendar/i))
      fireEvent.change(screen.getByLabelText(/open calendar/i), { target: { value: '2010-03-04' } })
      expect(screen.getByLabelText('Date')).toHaveValue('2010-03-04')
    } finally {
      proto.showPicker = origShowPicker
    }
  })

  it('keeps a half-typed date visible after blur instead of wiping it', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const input = screen.getByLabelText('Date')
    await user.type(input, '1987')
    await user.tab()

    // An incomplete entry emits '' upstream, but the digits stay on screen —
    // snapping the field back to the controlled '' loses them silently.
    expect(input).toHaveValue('1987')
  })

  it('does not refocus the text input when the calendar is opened from inside a wrapping label', async () => {
    const proto = HTMLInputElement.prototype as unknown as { showPicker?: () => void }
    const origShowPicker = proto.showPicker
    proto.showPicker = vi.fn()
    try {
      const user = userEvent.setup()
      // RegisterForm's TextField wraps the whole control in a <label>. A click
      // bubbling to that label is re-dispatched to the labelled input, which
      // would refocus it and dismiss the picker that just opened.
      render(
        <label>
          <span>DOB</span>
          <DateField value="" onChange={() => {}} aria-label="Date" />
        </label>
      )

      const input = screen.getByLabelText('Date')
      await user.click(screen.getByLabelText(/open calendar/i))

      expect(document.activeElement).not.toBe(input)
      expect(proto.showPicker).toHaveBeenCalled()
    } finally {
      proto.showPicker = origShowPicker
    }
  })
})
