import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventWaiverOverrides } from './EventWaiverOverrides'
import * as waivers from '../../lib/waivers'
import type { WaiverEventRef } from '../../lib/waivers'

const owCourse: WaiverEventRef = { id: 'C1', type: 'course', title: 'Open Water Course' }

beforeEach(() => vi.restoreAllMocks())

describe('EventWaiverOverrides', () => {
  it('shows each waiver with its effective required state from the global rule', async () => {
    vi.spyOn(waivers, 'fetchEventWaiverOverrides').mockResolvedValue([])
    render(<EventWaiverOverrides event={owCourse} isAdmin createdBy="admin1" />)

    // Continuing-ed + medical apply to an OW course; dive-liability does not.
    expect(await screen.findByText(/continuing education liability release/i)).toBeInTheDocument()
    expect(screen.getByText(/diver medical questionnaire/i)).toBeInTheDocument()
    expect(screen.getByText(/boat travel & scuba diving liability release/i)).toBeInTheDocument()
  })

  it('persists an exempt override when a rule-required waiver is toggled off', async () => {
    vi.spyOn(waivers, 'fetchEventWaiverOverrides').mockResolvedValue([])
    const setSpy = vi.spyOn(waivers, 'setEventWaiverOverride').mockResolvedValue()
    const user = userEvent.setup()
    render(<EventWaiverOverrides event={owCourse} isAdmin createdBy="admin1" />)

    const ceRow = (await screen.findByText(/continuing education liability release/i)).closest('li')!
    await user.click(within(ceRow).getByRole('button', { name: /exempt/i }))

    await waitFor(() => expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: owCourse, code: 'continuing_education', mode: 'exempt',
    })))
  })

  it('persists a require override when a non-applicable waiver is toggled on', async () => {
    vi.spyOn(waivers, 'fetchEventWaiverOverrides').mockResolvedValue([])
    const setSpy = vi.spyOn(waivers, 'setEventWaiverOverride').mockResolvedValue()
    const user = userEvent.setup()
    render(<EventWaiverOverrides event={owCourse} isAdmin createdBy="admin1" />)

    // Dive liability does NOT apply to a course by rule — toggling Required adds
    // a 'require' override.
    const liabRow = (await screen.findByText(/boat travel & scuba diving liability release/i)).closest('li')!
    await user.click(within(liabRow).getByRole('button', { name: /required/i }))

    await waitFor(() => expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({
      code: 'padi_liability', mode: 'require',
    })))
  })
})
