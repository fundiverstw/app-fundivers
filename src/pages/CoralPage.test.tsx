import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CoralPage } from './CoralPage'
import type { CoralSurveyRow, DiveSite } from '../types/database'

const {
  fetchDiveSites, submitCoralSurvey, fetchCoralSurveys,
  fetchPendingCoralSurveys, moderateCoralSurvey, useAuthMock,
} = vi.hoisted(() => ({
  fetchDiveSites: vi.fn(),
  submitCoralSurvey: vi.fn(),
  fetchCoralSurveys: vi.fn(),
  fetchPendingCoralSurveys: vi.fn(),
  moderateCoralSurvey: vi.fn(),
  useAuthMock: vi.fn(),
}))

vi.mock('../lib/dive-sites', () => ({
  fetchDiveSites: (...a: unknown[]) => fetchDiveSites(...a),
}))
vi.mock('../lib/coral-surveys', () => ({
  submitCoralSurvey: (...a: unknown[]) => submitCoralSurvey(...a),
  fetchCoralSurveys: (...a: unknown[]) => fetchCoralSurveys(...a),
  fetchPendingCoralSurveys: (...a: unknown[]) => fetchPendingCoralSurveys(...a),
  moderateCoralSurvey: (...a: unknown[]) => moderateCoralSurvey(...a),
}))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

const site = (id: string, name: string, over: Partial<DiveSite> = {}): DiveSite => ({
  id, name, kind: 'dive', region: null, notes: null, active: true,
  created_at: '', updated_at: '', ...over,
} as DiveSite)

const survey = (over: Partial<CoralSurveyRow> = {}): CoralSurveyRow => ({
  id: 's1', site_id: 'site-1', site_name: 'Bat Cave',
  surveyed_on: '2026-08-01', surveyed_at: '09:30:00',
  depth_m: 8, water_temp_c: 28.4,
  survey_method: 'random', transect_length_m: null,
  notes: null, created_at: '', diver_display: 'Ada',
  colonies: [
    { ordinal: 1, coral_type: 'branching', lightest_hue: 'C', lightest_level: 1, darkest_hue: 'C', darkest_level: 2, diameter_cm: 30 },
    { ordinal: 2, coral_type: 'boulder', lightest_hue: 'D', lightest_level: 4, darkest_hue: 'D', darkest_level: 6, diameter_cm: null },
  ],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  useAuthMock.mockReturnValue({ profile: { id: 'u1', role: 'diver' } })
  fetchDiveSites.mockResolvedValue([
    site('site-1', 'Bat Cave'),
    site('site-2', 'Longdong 4'),
    site('site-3', 'Retired reef', { active: false }),
    site('site-4', 'Mountain trail', { kind: 'adventure' }),
  ])
  fetchCoralSurveys.mockResolvedValue([])
  fetchPendingCoralSurveys.mockResolvedValue([])
  submitCoralSurvey.mockResolvedValue('new-survey')
  moderateCoralSurvey.mockResolvedValue(undefined)
})

/** Fill one colony row: growth form, then the four chart coordinates. */
async function fillColony(
  user: ReturnType<typeof userEvent.setup>,
  n: number,
  values: { type?: string; lh?: string; ll?: string; dh?: string; dl?: string; diameter?: string } = {},
) {
  const {
    type = 'branching', lh = 'C', ll = '3', dh = 'C', dl = '5', diameter,
  } = values
  await user.selectOptions(screen.getByLabelText(`Colony ${n} Growth form`), type)
  await user.selectOptions(screen.getByLabelText(`Colony ${n} Lightest hue`), lh)
  await user.selectOptions(screen.getByLabelText(`Colony ${n} Lightest level`), ll)
  await user.selectOptions(screen.getByLabelText(`Colony ${n} Darkest hue`), dh)
  await user.selectOptions(screen.getByLabelText(`Colony ${n} Darkest level`), dl)
  if (diameter !== undefined) {
    await user.type(screen.getByLabelText(`Colony ${n} Diameter (cm)`), diameter)
  }
}

describe('CoralPage', () => {
  it('offers only active dive sites — not adventure locations or retired reefs', async () => {
    render(<CoralPage />)
    const picker = await screen.findByLabelText('Dive site')
    const options = [...picker.querySelectorAll('option')].map(o => o.textContent)
    expect(options).toContain('Bat Cave')
    expect(options).toContain('Longdong 4')
    expect(options).not.toContain('Retired reef')
    expect(options).not.toContain('Mountain trail')
  })

  it('submits a survey with its colonies, sizes and conditions', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await user.type(screen.getByLabelText('Depth (m)'), '8.5')
    await user.type(screen.getByLabelText('Water temperature (°C)'), '29.1')
    await fillColony(user, 1, { diameter: '30' })

    await user.click(screen.getByRole('button', { name: /add a colony/i }))
    await fillColony(user, 2, { type: 'soft', lh: 'B', ll: '1', dh: 'B', dl: '2' })

    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    await waitFor(() => expect(submitCoralSurvey).toHaveBeenCalled())
    const call = submitCoralSurvey.mock.calls[0][0]
    expect(call.siteId).toBe('site-1')
    expect(call.depthM).toBe(8.5)
    expect(call.waterTempC).toBe(29.1)
    expect(call.colonies).toHaveLength(2)
    expect(call.colonies[0]).toMatchObject({
      coral_type: 'branching', lightest_level: 3, darkest_level: 5, diameter_cm: 30,
    })
    // A shade reading stands without a rule, so a blank diameter is null.
    expect(call.colonies[1]).toMatchObject({ coral_type: 'soft', diameter_cm: null })
  })

  it('asks for the transect length only when the method is a transect', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    expect(screen.queryByLabelText(/transect length/i)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Method'), 'transect')
    expect(screen.getByLabelText(/transect length/i)).toBeInTheDocument()
  })

  it('names the colony at fault rather than failing the whole form vaguely', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await fillColony(user, 1)
    await user.click(screen.getByRole('button', { name: /add a colony/i }))
    await user.click(screen.getByRole('button', { name: /add a colony/i }))
    await fillColony(user, 2)
    // Colony 3 is left blank.

    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    expect(await screen.findByText(/colony 3 is missing/i)).toBeInTheDocument()
    expect(submitCoralSurvey).not.toHaveBeenCalled()
  })

  // The chart is read palest first, so this is a transposed pair rather than an
  // impossible colony, and the message says so.
  it('catches a transposed shade pair before the round trip', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await fillColony(user, 1, { ll: '5', dl: '2' })
    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    expect(await screen.findByText(/the wrong way round/i)).toBeInTheDocument()
    expect(submitCoralSurvey).not.toHaveBeenCalled()
  })

  it('will not submit without a site', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await fillColony(user, 1)
    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    expect(await screen.findByText(/choose the site you surveyed/i)).toBeInTheDocument()
    expect(submitCoralSurvey).not.toHaveBeenCalled()
  })

  it('drops a colony row, and offers no remove button on the last one', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    // A survey needs at least one colony, so the sole row cannot be removed.
    expect(screen.queryByRole('button', { name: /^remove$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /add a colony/i }))
    expect(screen.getAllByRole('button', { name: /^remove$/i })).toHaveLength(2)

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await fillColony(user, 1)
    await fillColony(user, 2, { type: 'plate' })
    await user.click(screen.getAllByRole('button', { name: /^remove$/i })[0])

    await user.click(screen.getByRole('button', { name: /submit survey/i }))
    await waitFor(() => expect(submitCoralSurvey).toHaveBeenCalled())
    const { colonies } = submitCoralSurvey.mock.calls[0][0]
    expect(colonies).toHaveLength(1)
    expect(colonies[0].coral_type).toBe('plate')
  })

  it('sends a transect length only when the method is a transect', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await user.selectOptions(screen.getByLabelText('Method'), 'transect')
    await user.type(screen.getByLabelText(/transect length/i), '25')
    await fillColony(user, 1)
    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    await waitFor(() => expect(submitCoralSurvey).toHaveBeenCalled())
    expect(submitCoralSurvey.mock.calls[0][0]).toMatchObject({
      method: 'transect', transectLengthM: 25,
    })

    // Switching back to a method that has no transect withdraws the figure
    // rather than carrying it into a survey it does not describe.
    submitCoralSurvey.mockClear()
    await user.selectOptions(screen.getByLabelText('Method'), 'quadrat')
    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await fillColony(user, 1)
    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    await waitFor(() => expect(submitCoralSurvey).toHaveBeenCalled())
    expect(submitCoralSurvey.mock.calls[0][0]).toMatchObject({
      method: 'quadrat', transectLengthM: null,
    })
  })

  it('surfaces a failed submit and keeps what the diver typed', async () => {
    submitCoralSurvey.mockRejectedValue(new Error('coral_survey_already_reviewed'))
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await fillColony(user, 1)
    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    expect(await screen.findByText(/coral_survey_already_reviewed/)).toBeInTheDocument()
    // The form is not reset, so a diver can correct and resubmit.
    expect(screen.getByLabelText('Dive site')).toHaveValue('site-1')
    expect(screen.getByLabelText('Colony 1 Growth form')).toHaveValue('branching')
  })

  it('catches an out-of-range depth before the round trip', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await user.type(screen.getByLabelText('Depth (m)'), '120')
    await fillColony(user, 1)
    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    expect(await screen.findByText(/depth must be between 0 and 100/i)).toBeInTheDocument()
    expect(submitCoralSurvey).not.toHaveBeenCalled()
  })

  // A filed survey is pending, so it shows up in neither the approved history
  // nor a diver's review queue. Without a word, the form blanking itself reads
  // as the submission being lost.
  it('confirms that a filed survey is awaiting review', async () => {
    const user = userEvent.setup()
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')

    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-1')
    await fillColony(user, 1)
    await user.click(screen.getByRole('button', { name: /submit survey/i }))

    expect(await screen.findByText(/survey filed/i)).toBeInTheDocument()
    // And it clears as soon as the diver starts another one.
    await user.selectOptions(screen.getByLabelText('Dive site'), 'site-2')
    expect(screen.queryByText(/survey filed/i)).not.toBeInTheDocument()
  })

  it('shows an approved survey with its colonies and bleaching summary', async () => {
    fetchCoralSurveys.mockResolvedValue([survey()])
    render(<CoralPage />)

    expect(await screen.findByText('Bat Cave — Ada')).toBeInTheDocument()
    // Colony 1 darkest is level 2, so it is bleached; colony 2 is not.
    expect(screen.getByText(/1 bleached \(50%\)/)).toBeInTheDocument()
    // Mean of (1+2)/2 and (4+6)/2 is 3.3.
    expect(screen.getByText(/mean shade 3\.3/)).toBeInTheDocument()
    expect(screen.getByText('C1')).toBeInTheDocument()
    expect(screen.getByText('D6')).toBeInTheDocument()
  })

  it('hides the review queue from a diver', async () => {
    render(<CoralPage />)
    await screen.findByLabelText('Dive site')
    expect(screen.queryByRole('region', { name: /awaiting review/i })).not.toBeInTheDocument()
    expect(fetchPendingCoralSurveys).not.toHaveBeenCalled()
  })

  it('lets staff approve a pending survey with a note', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 'u2', role: 'staff' } })
    fetchPendingCoralSurveys.mockResolvedValue([survey({ id: 'p1' })])
    const user = userEvent.setup()
    render(<CoralPage />)

    await screen.findByRole('region', { name: /awaiting review/i })
    await user.type(screen.getByLabelText(/review note for the bat cave survey/i), 'Checked')
    await user.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => expect(moderateCoralSurvey).toHaveBeenCalledWith('p1', 'approved', 'Checked'))
  })

  it('lets staff reject, and sends no note when none was typed', async () => {
    useAuthMock.mockReturnValue({ profile: { id: 'u2', role: 'admin' } })
    fetchPendingCoralSurveys.mockResolvedValue([survey({ id: 'p2' })])
    const user = userEvent.setup()
    render(<CoralPage />)

    await screen.findByRole('region', { name: /awaiting review/i })
    await user.click(screen.getByRole('button', { name: /^reject$/i }))

    await waitFor(() => expect(moderateCoralSurvey).toHaveBeenCalledWith('p2', 'rejected', null))
  })
})
