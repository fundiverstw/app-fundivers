import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { HeightField, WeightField } from './MeasureField'

const INPUT = 'input'

function HeightHarness({ initial = null }: { initial?: number | null }) {
  const [cm, setCm] = useState<number | null>(initial)
  return (
    <>
      <HeightField valueCm={cm} onChange={setCm} inputClassName={INPUT} />
      <output>{cm == null ? 'unset' : String(cm)}</output>
    </>
  )
}

function WeightHarness({ initial = null }: { initial?: number | null }) {
  const [kg, setKg] = useState<number | null>(initial)
  return (
    <>
      <WeightField valueKg={kg} onChange={setKg} inputClassName={INPUT} />
      <output>{kg == null ? 'unset' : String(kg)}</output>
    </>
  )
}

beforeEach(() => localStorage.clear())

describe('HeightField', () => {
  it('opens in the shop default (metric) and reports centimeters', async () => {
    const user = userEvent.setup()
    render(<HeightHarness />)
    await user.type(screen.getByLabelText(/height \(cm\)/i), '170')
    expect(screen.getByText('170')).toBeInTheDocument()
  })
})

describe('HeightField in imperial', () => {
  it('switches to feet + inches showing the same height, and reports centimeters back', async () => {
    const user = userEvent.setup()
    render(<HeightHarness initial={170} />)

    expect((screen.getByLabelText(/height \(cm\)/i) as HTMLInputElement).value).toBe('170')

    await user.click(screen.getByRole('button', { name: /ft\/lb/i }))

    // 170cm reads as 5'7" — the diver sees their own height, not a blank form.
    expect((screen.getByLabelText(/height \(feet\)/i) as HTMLInputElement).value).toBe('5')
    expect((screen.getByLabelText(/height \(inches\)/i) as HTMLInputElement).value).toBe('7')

    const feet = screen.getByLabelText(/height \(feet\)/i)
    await user.clear(feet)
    await user.type(feet, '6')

    // 6'7" is 200.7cm — the column still receives metric.
    expect(screen.getByText('200.7')).toBeInTheDocument()
  })

  it('clearing both boxes clears the measurement rather than storing a zero', async () => {
    const user = userEvent.setup()
    render(<HeightHarness initial={170} />)
    await user.click(screen.getByRole('button', { name: /ft\/lb/i }))
    await user.clear(screen.getByLabelText(/height \(feet\)/i))
    await user.clear(screen.getByLabelText(/height \(inches\)/i))
    expect(screen.getByText('unset')).toBeInTheDocument()
  })

  it('treats an empty inches box as a flat foot count, not a blocked entry', async () => {
    const user = userEvent.setup()
    render(<HeightHarness />)
    await user.click(screen.getByRole('button', { name: /ft\/lb/i }))
    await user.type(screen.getByLabelText(/height \(feet\)/i), '6')
    expect(screen.getByText('182.9')).toBeInTheDocument()
  })
})

describe('WeightField', () => {
  it('shows pounds in imperial and reports kilograms', async () => {
    const user = userEvent.setup()
    render(<WeightHarness initial={70} />)
    expect((screen.getByLabelText(/weight \(kg\)/i) as HTMLInputElement).value).toBe('70')

    await user.click(screen.getByRole('button', { name: /ft\/lb/i }))
    expect((screen.getByLabelText(/weight \(lb\)/i) as HTMLInputElement).value).toBe('154')

    const lb = screen.getByLabelText(/weight \(lb\)/i)
    await user.clear(lb)
    await user.type(lb, '160')
    expect(screen.getByText('72.6')).toBeInTheDocument()
  })

  it('clearing the box clears the measurement', async () => {
    const user = userEvent.setup()
    render(<WeightHarness initial={70} />)
    await user.clear(screen.getByLabelText(/weight \(kg\)/i))
    expect(screen.getByText('unset')).toBeInTheDocument()
  })
})

describe('the toggle is shared', () => {
  // Flipping height to imperial and finding weight still in kilograms is the
  // exact papercut this replaced, so both fields listen to one preference.
  it('moves every mounted field at once', async () => {
    const user = userEvent.setup()
    render(
      <>
        <HeightHarness initial={170} />
        <WeightHarness initial={70} />
      </>,
    )
    await user.click(screen.getAllByRole('button', { name: /ft\/lb/i })[0])
    expect(screen.getByLabelText(/height \(feet\)/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/weight \(lb\)/i)).toBeInTheDocument()
  })

  it('remembers the choice for the next visit', async () => {
    const user = userEvent.setup()
    render(<HeightHarness />)
    await user.click(screen.getByRole('button', { name: /ft\/lb/i }))
    expect(localStorage.getItem('fundive.units')).toBe('imperial')
  })

  // Merely viewing the imperial side must not nudge the stored value: 180cm
  // renders as 5'11", which converts back to 180.3.
  it('does not rewrite an untouched height when the unit changes', async () => {
    const user = userEvent.setup()
    render(<HeightHarness initial={180} />)
    await user.click(screen.getByRole('button', { name: /ft\/lb/i }))
    expect(screen.getByText('180')).toBeInTheDocument()
  })
})

describe('storage failure', () => {
  it('still renders and toggles when localStorage throws', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    const user = userEvent.setup()
    render(<HeightHarness initial={170} />)
    await user.click(screen.getByRole('button', { name: /ft\/lb/i }))
    expect(screen.getByLabelText(/height \(feet\)/i)).toBeInTheDocument()
    set.mockRestore()
  })
})
