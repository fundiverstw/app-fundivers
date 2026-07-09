import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MyWaivers } from './MyWaivers'
import * as waivers from '../../lib/waivers'
import type { WaiverSignature } from '../../types/database'
import type { WaiverDef } from '../../config/waivers'

const sig = (over: Partial<WaiverSignature>): WaiverSignature => ({
  id: 's', created_at: '', diver_id: 'u1', waiver_code: 'diver_medical', waiver_version: 1,
  signed_name: 'Jane', signed_at: new Date().toISOString(), event_id: null, ...over,
})

// The annual catalog the panel fetches (was src/config/waivers.ts).
const CATALOG: WaiverDef[] = [
  { code: 'padi_liability', title: 'Boat Travel & Scuba Diving Liability Release', cadence: 'annual', version: 1, appliesTo: 'dives', body: 'x' },
  { code: 'diver_medical', title: 'Diver Medical Questionnaire', cadence: 'annual', version: 1, appliesTo: 'none', body: 'x' },
]

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(waivers, 'fetchWaivers').mockResolvedValue(CATALOG)
})

describe('MyWaivers', () => {
  it('lists the annual waivers with their status', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([sig({ waiver_code: 'diver_medical' })])
    render(<MyWaivers diverId="u1" />)

    expect(await screen.findByText(/diver medical questionnaire/i)).toBeInTheDocument()
    // Medical is signed (fresh), liability is not.
    expect(screen.getByText(/^signed/i)).toBeInTheDocument()
    expect(screen.getByText(/not signed/i)).toBeInTheDocument()
    // Both rows offer an action button.
    expect(screen.getByRole('button', { name: /re-sign/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^sign$/i })).toBeInTheDocument()
  })

  it('opens the sign dialog for an unsigned waiver', async () => {
    vi.spyOn(waivers, 'fetchDiverSignatures').mockResolvedValue([])
    const user = userEvent.setup()
    render(<MyWaivers diverId="u1" />)

    await screen.findByText(/boat travel & scuba diving liability release/i)
    await user.click(screen.getAllByRole('button', { name: /^sign$/i })[0])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
