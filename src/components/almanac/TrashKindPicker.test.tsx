import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrashKindPicker } from './TrashKindPicker'
import { t } from '../../i18n'
import { ALMANAC_TRASH_KINDS } from '../../types/database'

describe('TrashKindPicker', () => {
  it('offers every material and marks the chosen ones', () => {
    render(<TrashKindPicker selected={['plastic', 'glass']} onChange={() => {}} />)

    for (const kind of ALMANAC_TRASH_KINDS) {
      expect(screen.getByLabelText(t.almanac.trashKinds[kind])).toBeInTheDocument()
    }
    expect(screen.getByLabelText(t.almanac.trashKinds.plastic)).toBeChecked()
    expect(screen.getByLabelText(t.almanac.trashKinds.styrofoam)).not.toBeChecked()
  })

  it('adds a material without dropping the ones already chosen', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TrashKindPicker selected={['plastic']} onChange={onChange} />)

    await user.click(screen.getByLabelText(t.almanac.trashKinds.fishing_gear))
    expect(onChange).toHaveBeenCalledWith(['plastic', 'fishing_gear'])
  })

  it('takes one back off', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TrashKindPicker selected={['plastic', 'metal']} onChange={onChange} />)

    await user.click(screen.getByLabelText(t.almanac.trashKinds.plastic))
    expect(onChange).toHaveBeenCalledWith(['metal'])
  })

  // Disabled rather than hidden: a count of zero answers this question, and a
  // field that vanished would read as the form losing it.
  it('stays on screen but unusable once the count says there was none', () => {
    render(<TrashKindPicker selected={[]} onChange={() => {}} disabled />)

    expect(screen.getByLabelText(t.almanac.trashKinds.plastic)).toBeDisabled()
    expect(screen.getByText(t.almanac.trashNoneNote)).toBeInTheDocument()
  })
})
