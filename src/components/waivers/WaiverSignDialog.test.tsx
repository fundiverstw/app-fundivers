import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WaiverSignDialog } from './WaiverSignDialog'
import type { WaiverDef } from '../../config/waivers'
import * as waivers from '../../lib/waivers'

const CE: WaiverDef = { code: 'continuing_education', title: 'Continuing Education Liability Release', cadence: 'per_event', version: 1, appliesTo: 'courses', body: 'Continuing-ed release text.' }
const MEDICAL: WaiverDef = { code: 'diver_medical', title: 'Diver Medical Questionnaire', cadence: 'annual', version: 1, appliesTo: 'none', body: 'Medical questionnaire text.' }

beforeEach(() => vi.restoreAllMocks())

describe('WaiverSignDialog', () => {
  it('disables Sign until a name is typed and the box is checked', async () => {
    const user = userEvent.setup()
    render(<WaiverSignDialog def={MEDICAL} onSigned={() => {}} onClose={() => {}} />)
    const signBtn = screen.getByRole('button', { name: /^sign$/i })
    expect(signBtn).toBeDisabled()

    await user.type(screen.getByLabelText(/full name/i), 'Jane Diver')
    expect(signBtn).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(signBtn).toBeEnabled()
  })

  it('passes the per-event context and reports success', async () => {
    const spy = vi.spyOn(waivers, 'signWaiver').mockResolvedValue('sig-1')
    const onSigned = vi.fn()
    const event = { id: 'C1', type: 'course' as const, title: 'Open Water Course' }
    const user = userEvent.setup()
    render(<WaiverSignDialog def={CE} event={event} onSigned={onSigned} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/full name/i), '  Jane Diver  ')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^sign$/i }))

    await waitFor(() => expect(onSigned).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith({ def: CE, signedName: 'Jane Diver', event })
  })

  it('surfaces an error and keeps the dialog open on failure', async () => {
    vi.spyOn(waivers, 'signWaiver').mockRejectedValue(new Error('boom'))
    const onSigned = vi.fn()
    const user = userEvent.setup()
    render(<WaiverSignDialog def={MEDICAL} onSigned={onSigned} onClose={() => {}} />)

    await user.type(screen.getByLabelText(/full name/i), 'Jane')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /^sign$/i }))

    expect(await screen.findByText(/could not record your signature/i)).toBeInTheDocument()
    expect(onSigned).not.toHaveBeenCalled()
  })
})
