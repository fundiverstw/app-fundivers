import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: /open calendar/i })).toBeInTheDocument()
  })
})
