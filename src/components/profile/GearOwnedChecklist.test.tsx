import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { GearOwnedChecklist } from './GearOwnedChecklist'
import { t } from '../../i18n'

const RUBBER = 'Boots (rubber sole)'
const FELT = 'Boots (felt sole)'

/** The page owns the array, so drive the component the way the page does. */
function Harness({ initial = [], onChange }: { initial?: string[]; onChange?: (v: string[]) => void }) {
  const [owned, setOwned] = useState<string[]>(initial)
  return (
    <GearOwnedChecklist
      owned={owned}
      onChange={next => { setOwned(next); onChange?.(next) }}
    />
  )
}

const box = (name: string | RegExp) => screen.getByLabelText(name) as HTMLInputElement
const styles = () => screen.getByLabelText(t.profile.gearStylesFor('Boots'))

describe('GearOwnedChecklist', () => {
  it('offers one Boots checkbox rather than one per sole', () => {
    render(<Harness />)
    expect(box('Boots')).toBeInTheDocument()
    expect(screen.queryByLabelText(RUBBER)).toBeNull()
    expect(screen.queryByLabelText(FELT)).toBeNull()
  })

  it('leaves single-style items as plain checkboxes', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(box('BCD').checked).toBe(false)
    await user.click(box('BCD'))
    expect(box('BCD').checked).toBe(true)
  })

  it('asks which sole once the item is ticked, and records nothing until told', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(box('Boots'))
    expect(box('Boots').checked).toBe(true)
    expect(screen.getByText(t.profile.gearPickStyle)).toBeInTheDocument()
    // A tick is not an answer: which sole they own is the question being asked.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('records the sole the diver picks', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(box('Boots'))
    await user.click(box('felt sole'))
    expect(onChange).toHaveBeenLastCalledWith([FELT])
    expect(screen.queryByText(t.profile.gearPickStyle)).toBeNull()
    expect(styles()).toHaveTextContent('felt sole')
  })

  it('lets a diver own both soles', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.click(box('Boots'))
    await user.click(box('rubber sole'))
    await user.click(box('felt sole'))
    expect(onChange).toHaveBeenLastCalledWith([RUBBER, FELT])
    expect(styles()).toHaveTextContent('rubber sole, felt sole')
  })

  it('starts ticked, closed and summarised for a diver who already owns a pair', () => {
    render(<Harness initial={[RUBBER]} />)
    expect(box('Boots').checked).toBe(true)
    expect(styles()).toHaveTextContent('rubber sole')
    expect(screen.queryByText(t.profile.gearPickStyle)).toBeNull()
  })

  it('drops every sole at once when the item is unticked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness initial={[RUBBER, FELT, 'BCD']} onChange={onChange} />)

    await user.click(box('Boots'))
    expect(onChange).toHaveBeenLastCalledWith(['BCD'])
    expect(box('Boots').checked).toBe(false)
    expect(screen.queryByText(t.profile.gearPickStyle)).toBeNull()
  })

  it('unticks the item when the diver clears the last sole by hand', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[FELT]} />)

    await user.click(box('felt sole'))
    expect(box('Boots').checked).toBe(false)
    expect(styles()).toHaveTextContent(t.profile.gearChooseStyle)
  })

  it('unticks it the same way straight after a fresh choice', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(box('Boots'))
    await user.click(box('felt sole'))
    await user.click(box('felt sole'))
    expect(box('Boots').checked).toBe(false)
    expect(screen.queryByText(t.profile.gearPickStyle)).toBeNull()
  })

  it('opens the styles on demand and closes them again', async () => {
    const user = userEvent.setup()
    render(<Harness initial={[FELT]} />)
    const details = styles().closest('details') as HTMLDetailsElement

    expect(details.open).toBe(false)
    await user.click(styles())
    expect(details.open).toBe(true)
    await user.click(styles())
    expect(details.open).toBe(false)
  })
})
