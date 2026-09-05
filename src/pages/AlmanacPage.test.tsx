import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlmanacPage } from './AlmanacPage'
import { mockQueryBuilder } from '../../tests/test-utils'
import { t } from '../i18n'
import { EVENT_KIND_LABELS } from '../lib/event-kind-labels'
import { ALMANAC_TRASH_BANDS } from '../types/database'

const authState = { role: 'diver' as 'diver' | 'staff' }

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'diver-1' },
    profile: { id: 'diver-1', role: authState.role },
    loading: false,
  }),
}))

const sites = [
  { id: 'site-1', name: 'Bat Cave', kind: 'dive', region: 'Longdong', active: true },
  { id: 'site-2', name: 'Dragon Head', kind: 'dive', region: null, active: true },
  { id: 'site-3', name: 'Hehuanshan', kind: 'adventure', region: null, active: true },
  { id: 'site-4', name: 'Closed Cove', kind: 'dive', region: null, active: false },
]

// Only the fetch is stubbed. siteName and the rest are pure and shared with
// the add-a-place form, and stubbing them would hide the language fallback the
// picker depends on.
vi.mock('../lib/dive-sites', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/dive-sites')>()),
  fetchDiveSites: vi.fn(async () => sites),
}))

const rpc = vi.fn()
const from = vi.fn(() => mockQueryBuilder({ data: [], error: null }))

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}))

const approvedRecord = {
  id: 'record-1',
  site_id: 'site-1',
  site_name: 'Bat Cave',
  site_kind: 'dive',
  created_at: '2026-08-02T00:00:00Z',
  obs_date: '2026-08-01',
  air_temp_c: 30,
  water_temp_c: 28,
  visibility_m: 12,
  current_strength: 'light',
  wave_height_m: null,
  wave_period_s: null,
  weather: 'clear',
  wildlife: ['turtle'],
  coral_health: null,
  elevation_m: null,
  route_condition: null,
  summit_visible: null,
  diver_display: 'Mei',
}

const pendingRecord = { ...approvedRecord, id: 'record-2' }

function mockRpc(overrides: Record<string, unknown[]> = {}) {
  rpc.mockImplementation(async (name: string) => ({
    data: overrides[name] ?? [],
    error: null,
  }))
}

function renderPage() {
  return render(<AlmanacPage />)
}

describe('AlmanacPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.role = 'diver'
    mockRpc()
  })

  it('reads the history as one date window, not one call per place', async () => {
    const user = userEvent.setup()
    mockRpc({ almanac_records_in_range: [approvedRecord] })
    renderPage()

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('almanac_records_in_range',
      expect.objectContaining({ p_from: expect.any(String), p_to: expect.any(String) })))
    expect(rpc.mock.calls.filter(c => c[0] === 'almanac_records_in_range')).toHaveLength(1)
    await user.click(await screen.findByRole('tab', { name: t.almanac.tabView }))
    expect(screen.getByText(t.almanac.recordsHeading)).toBeInTheDocument()
  })

  // Filing and reading are separate errands, so the page opens on the form and
  // keeps the history one button away rather than below a long scroll.
  it('opens on the form and shows the history only under View data', async () => {
    const user = userEvent.setup()
    mockRpc({ almanac_records_in_range: [approvedRecord] })
    renderPage()

    expect(await screen.findByRole('button', { name: t.almanac.submitRecord })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: t.almanac.tabEnter })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(t.almanac.recordsHeading)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: t.almanac.tabView }))
    expect(screen.getByText(t.almanac.recordsHeading)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.almanac.submitRecord })).not.toBeInTheDocument()

    // And back — the form is still there, not a one-way trip.
    await user.click(screen.getByRole('tab', { name: t.almanac.tabEnter }))
    expect(screen.getByRole('button', { name: t.almanac.submitRecord })).toBeInTheDocument()
  })

  it('groups the history by calendar date, merging sites that share a day', async () => {
    const user = userEvent.setup()
    mockRpc({
      almanac_records_in_range: [
        approvedRecord,
        { ...approvedRecord, id: 'record-3', site_id: 'site-2', site_name: 'Dragon Head', diver_display: 'Jun' },
        { ...approvedRecord, id: 'record-4', obs_date: '2026-07-30' },
      ],
    })
    renderPage()
    await user.click(await screen.findByRole('tab', { name: t.almanac.tabView }))

    const days = await screen.findAllByText(/Aug 1, 2026|Jul 30, 2026/)
    expect(days).toHaveLength(2)

    const augCard = screen.getByRole('button', { name: /Aug 1, 2026/ }).parentElement!
    await user.click(screen.getByRole('button', { name: /Aug 1, 2026/ }))
    expect(within(augCard).getByText('Bat Cave')).toBeInTheDocument()
    expect(within(augCard).getByText('Dragon Head')).toBeInTheDocument()
    expect(within(augCard).getByText(t.almanac.observationCount(2))).toBeInTheDocument()
  })

  it('reads one place on one day once both halves of the lookup are answered', async () => {
    const user = userEvent.setup()
    mockRpc({ almanac_records_in_range: [approvedRecord] })
    renderPage()
    await user.click(await screen.findByRole('tab', { name: t.almanac.tabView }))

    // A half-answered lookup is not a lookup: the browse list stays up.
    await user.selectOptions(screen.getByLabelText(t.almanac.lookupSite), 'site-1')
    expect(screen.getByText(t.almanac.recordsHeading)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(t.almanac.lookupDate), { target: { value: '2026-08-01' } })

    // The day is read as its own one-day window, so a lookup can reach past
    // the 90 days the page itself holds.
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('almanac_records_in_range',
      { p_from: '2026-08-01', p_to: '2026-08-01' }))
    expect(await screen.findByText(t.almanac.whoReported)).toBeInTheDocument()
    expect(screen.queryByText(t.almanac.recordsHeading)).not.toBeInTheDocument()
  })

  it('says nothing was filed rather than showing an empty report', async () => {
    const user = userEvent.setup()
    mockRpc({ almanac_records_in_range: [{ ...approvedRecord, site_id: 'site-2' }] })
    renderPage()
    await user.click(await screen.findByRole('tab', { name: t.almanac.tabView }))

    await user.selectOptions(screen.getByLabelText(t.almanac.lookupSite), 'site-1')
    fireEvent.change(screen.getByLabelText(t.almanac.lookupDate), { target: { value: '2026-08-01' } })

    // The day held a record, but for another place.
    expect(await screen.findByText(t.almanac.noDayRecords)).toBeInTheDocument()
  })

  it('gives the browse list back when the lookup is cleared', async () => {
    const user = userEvent.setup()
    mockRpc({ almanac_records_in_range: [approvedRecord] })
    renderPage()
    await user.click(await screen.findByRole('tab', { name: t.almanac.tabView }))

    await user.selectOptions(screen.getByLabelText(t.almanac.lookupSite), 'site-1')
    fireEvent.change(screen.getByLabelText(t.almanac.lookupDate), { target: { value: '2026-08-01' } })
    expect(await screen.findByText(t.almanac.whoReported)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: t.almanac.lookupClear }))

    expect(await screen.findByText(t.almanac.recordsHeading)).toBeInTheDocument()
    expect(screen.queryByText(t.almanac.whoReported)).not.toBeInTheDocument()
  })

  // A place the shop retired keeps the days it was dived, so the lookup still
  // offers it even though the submission form has stopped.
  it('offers retired places for lookup, unlike the submission form', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('tab', { name: t.almanac.tabView }))

    const picker = screen.getByLabelText(t.almanac.lookupSite) as HTMLSelectElement
    expect([...picker.options].map(o => o.value)).toContain('site-4')
  })

  it('submits the form through the RPC, parsing numbers and wildlife', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.selectOptions(screen.getByLabelText(t.almanac.siteDive), 'site-1')
    await user.type(screen.getByLabelText(t.almanac.airTemp), '29.5')
    await user.type(screen.getByLabelText(t.almanac.wildlife), 'turtle, manta ray')
    await user.click(screen.getByRole('button', { name: t.almanac.submitRecord }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('submit_almanac_record',
      expect.objectContaining({
        p_site_id: 'site-1',
        p_air_temp_c: 29.5,
        p_water_temp_c: null,
        p_wildlife: ['turtle', 'manta ray'],
      })))
    expect(await screen.findByText(t.almanac.submitted)).toBeInTheDocument()
  })

  it('files the trash band and the materials alongside it', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.selectOptions(screen.getByLabelText(t.almanac.siteDive), 'site-1')
    await user.selectOptions(screen.getByLabelText(t.almanac.trashAmount), 'noticeable')
    await user.click(screen.getByLabelText(t.almanac.trashKinds.plastic))
    await user.click(screen.getByLabelText(t.almanac.trashKinds.fishing_gear))
    await user.click(screen.getByRole('button', { name: t.almanac.submitRecord }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('submit_almanac_record',
      expect.objectContaining({
        p_trash_band: 'noticeable',
        p_trash_kinds: ['plastic', 'fishing_gear'],
      })))
  })

  // A blank band is "did not look". Left as-is it must reach the RPC as null.
  it('sends null for an amount the diver never touched', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.selectOptions(screen.getByLabelText(t.almanac.siteDive), 'site-1')
    await user.click(screen.getByRole('button', { name: t.almanac.submitRecord }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('submit_almanac_record',
      expect.objectContaining({ p_trash_band: null })))
  })

  // "None" is "looked, saw none" — the reading a clean site produces, and the
  // one that must survive the trip to the RPC as an answer rather than a blank.
  it('sends "none" as the reading it is, not as no answer', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.selectOptions(screen.getByLabelText(t.almanac.siteDive), 'site-1')
    await user.selectOptions(screen.getByLabelText(t.almanac.trashAmount), 'none')
    await user.click(screen.getByRole('button', { name: t.almanac.submitRecord }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('submit_almanac_record',
      expect.objectContaining({ p_trash_band: 'none' })))
  })

  it('offers every band the almanac knows about', async () => {
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    const field = screen.getByLabelText(t.almanac.trashAmount)
    for (const band of ALMANAC_TRASH_BANDS) {
      expect(within(field).getByRole('option', { name: t.almanac.trashBands[band] })).toBeInTheDocument()
    }
  })

  it('stops asking what kind once the diver says there was none', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    expect(screen.getByLabelText(t.almanac.trashKinds.plastic)).not.toBeDisabled()
    await user.selectOptions(screen.getByLabelText(t.almanac.trashAmount), 'none')
    expect(screen.getByLabelText(t.almanac.trashKinds.plastic)).toBeDisabled()
  })

  it('offers only the active places of the toggled kind, and asks an adventure for its terrain', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    // site-4 is retired, so it keeps its history but is not offered.
    const dives = screen.getByLabelText(t.almanac.siteDive) as HTMLSelectElement
    expect([...dives.options].map(o => o.value)).toEqual(['', 'site-1', 'site-2'])
    expect(screen.queryByLabelText(t.almanac.elevation)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: EVENT_KIND_LABELS.adventure }))

    const adventures = screen.getByLabelText(t.almanac.siteAdventure) as HTMLSelectElement
    expect([...adventures.options].map(o => o.value)).toEqual(['', 'site-3'])
    expect(screen.getByLabelText(t.almanac.elevation)).toBeInTheDocument()
  })

  it('surfaces a failed submission instead of reporting success', async () => {
    const user = userEvent.setup()
    rpc.mockImplementation(async (name: string) =>
      name === 'submit_almanac_record'
        ? { data: null, error: { message: 'permission denied' } }
        : { data: [], error: null })
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.selectOptions(screen.getByLabelText(t.almanac.siteDive), 'site-1')
    await user.click(screen.getByRole('button', { name: t.almanac.submitRecord }))

    expect(await screen.findByText(t.almanac.submitFailed)).toBeInTheDocument()
    expect(screen.queryByText(t.almanac.submitted)).not.toBeInTheDocument()
  })

  it('keeps the review queue out of a diver\'s page', async () => {
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    expect(rpc).not.toHaveBeenCalledWith('almanac_pending_records', expect.anything())
    expect(screen.queryByText(t.almanac.approve)).not.toBeInTheDocument()
  })

  it('tells staff when the queue failed to load rather than showing it empty', async () => {
    authState.role = 'staff'
    rpc.mockImplementation(async (name: string) =>
      name === 'almanac_pending_records'
        ? { data: null, error: { message: 'function does not exist' } }
        : { data: [], error: null })
    renderPage()

    expect(await screen.findByText(t.almanac.recordsFailed)).toBeInTheDocument()
    expect(screen.queryByText(t.almanac.queueEmpty)).not.toBeInTheDocument()
  })

  it('lets staff approve a pending record', async () => {
    authState.role = 'staff'
    const user = userEvent.setup()
    mockRpc({ almanac_pending_records: [pendingRecord] })
    renderPage()

    await user.click(await screen.findByRole('button', { name: t.almanac.approve }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('moderate_almanac_record', {
      p_record_id: 'record-2',
      p_status: 'approved',
      p_staff_notes: null,
    }))
  })
})

describe('AlmanacPage — adding a place', () => {
  it('offers to add one right beside the picker, not in an admin screen', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.click(screen.getByRole('button', { name: t.sites.addHeading }))
    expect(screen.getByLabelText(t.sites.nameEn)).toBeInTheDocument()
    // The picker steps aside while they are adding, so there is one question
    // on screen rather than two that contradict each other.
    expect(screen.queryByLabelText(t.almanac.siteDive)).not.toBeInTheDocument()
  })

  it('puts the picker back, with nothing lost, if they change their mind', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.click(screen.getByRole('button', { name: t.sites.addHeading }))
    await user.click(screen.getByRole('button', { name: t.sites.cancel }))
    expect(screen.getByLabelText(t.almanac.siteDive)).toBeInTheDocument()
  })
})
