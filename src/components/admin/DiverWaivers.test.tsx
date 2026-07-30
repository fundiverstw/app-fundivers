import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DiverWaivers } from './DiverWaivers'
import * as waivers from '../../lib/waivers'
import type { WaiverSignature } from '../../types/database'
import type { WaiverDef } from '../../config/waivers'

let role: 'admin' | 'staff' = 'admin'
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'admin1' }, profile: { id: 'admin1', role } }),
}))

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(), toastError: vi.fn(),
}))
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
}))

const sig = (over: Partial<WaiverSignature>): WaiverSignature => ({
  id: 's1', created_at: '', diver_id: 'u1', waiver_code: 'diver_medical', waiver_version: 1,
  signed_name: 'Jane Diver', signed_at: new Date().toISOString(), event_id: null,
  signed_title: null, signed_body: null, signed_pdf_path: null, content_sha256: null,
  method: 'e_signed', recorded_by: null, ...over,
})

const CATALOG: WaiverDef[] = [
  { code: 'padi_liability', title: 'Boat Travel & Scuba Diving Liability Release', cadence: 'annual', version: 1, appliesTo: 'dives', body: 'x' },
  { code: 'diver_medical', title: 'Diver Medical Questionnaire', cadence: 'annual', version: 1, appliesTo: 'none', body: 'x' },
  // per_event waivers belong to the event roster, not this panel.
  { code: 'continuing_education', title: 'Continuing Education Liability Release', cadence: 'per_event', version: 1, appliesTo: 'courses', body: 'x' },
]

beforeEach(() => {
  vi.restoreAllMocks()
  role = 'admin'
  toastSuccess.mockReset()
  toastError.mockReset()
  vi.spyOn(waivers, 'fetchWaivers').mockResolvedValue(CATALOG)
})

describe('DiverWaivers', () => {
  it('lists only the diver-level waivers, with status', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([sig({ waiver_code: 'diver_medical' })])
    render(<DiverWaivers diverId="u1" diverName="Jane Diver" />)

    expect(await screen.findByText(/diver medical questionnaire/i)).toBeInTheDocument()
    expect(screen.getByText(/boat travel & scuba diving liability release/i)).toBeInTheDocument()
    // The per_event waiver needs an event to be meaningful — not offered here.
    expect(screen.queryByText(/continuing education/i)).not.toBeInTheDocument()
    // Medical is signed (fresh), liability has never been signed.
    expect(screen.getByText(/valid until/i)).toBeInTheDocument()
    expect(screen.getByText(/not signed/i)).toBeInTheDocument()
  })

  it('distinguishes a paper record from an in-app signature', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([
      sig({ waiver_code: 'diver_medical', method: 'in_person', recorded_by: 'admin1' }),
      sig({ id: 's2', waiver_code: 'padi_liability', method: 'e_signed' }),
    ])
    render(<DiverWaivers diverId="u1" diverName="Jane Diver" />)

    expect(await screen.findByText(/recorded in person/i)).toBeInTheDocument()
    expect(screen.getByText(/signed in the app/i)).toBeInTheDocument()
  })

  it('records an unsigned diver-level waiver as done in person', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([])
    const record = vi.spyOn(waivers, 'recordPaperWaiver').mockResolvedValue('newsig')
    window.confirm = vi.fn(() => true)
    const user = userEvent.setup()
    render(<DiverWaivers diverId="u1" diverName="Jane Diver" />)

    const buttons = await screen.findAllByRole('button', { name: /mark done in person/i })
    await user.click(buttons[0])

    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      diverId: 'u1',
      signedName: 'Jane Diver',
      def: expect.objectContaining({ code: 'padi_liability' }),
    }))
    // No event: an annual waiver is not tied to one.
    expect(record.mock.calls[0][0].event).toBeUndefined()
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('does nothing when the admin cancels the confirm', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([])
    const record = vi.spyOn(waivers, 'recordPaperWaiver').mockResolvedValue('newsig')
    window.confirm = vi.fn(() => false)
    const user = userEvent.setup()
    render(<DiverWaivers diverId="u1" diverName="Jane Diver" />)

    await user.click((await screen.findAllByRole('button', { name: /mark done in person/i }))[0])
    expect(record).not.toHaveBeenCalled()
  })

  it('surfaces a failed recording as an error toast', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([])
    vi.spyOn(waivers, 'recordPaperWaiver').mockRejectedValue(new Error('admin only'))
    window.confirm = vi.fn(() => true)
    const user = userEvent.setup()
    render(<DiverWaivers diverId="u1" diverName="Jane Diver" />)

    await user.click((await screen.findAllByRole('button', { name: /mark done in person/i }))[0])
    expect(toastError).toHaveBeenCalled()
  })

  // The RPC is admin-gated; staff would only get a rejection.
  it('offers no recording button to a staff viewer', async () => {
    role = 'staff'
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([])
    render(<DiverWaivers diverId="u1" diverName="Jane Diver" />)

    expect(await screen.findByText(/diver medical questionnaire/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark done in person/i })).not.toBeInTheDocument()
  })

  it('withholds recording, but still shows status, when the profile has no name', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([])
    render(<DiverWaivers diverId="u1" diverName={null} />)

    expect(await screen.findByText(/diver medical questionnaire/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark done in person/i })).not.toBeInTheDocument()
    expect(screen.getByText(/add a name to this profile/i)).toBeInTheDocument()
  })

  // Guessing either way is wrong: "not signed" invites a duplicate paper
  // record, "signed" hides a genuinely missing form.
  it('says a failed load failed, rather than guessing at the statuses', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockRejectedValue(new Error('nope'))
    render(<DiverWaivers diverId="u1" diverName="Jane Diver" />)

    expect(await screen.findByText(/could not load waiver status/i)).toBeInTheDocument()
    expect(screen.queryByText(/not signed/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark done in person/i })).not.toBeInTheDocument()
  })
})
