import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlmanacPage } from './AlmanacPage'
import { mockQueryBuilder } from '../../tests/test-utils'
import { t } from '../i18n'

const authState = { role: 'diver' as 'diver' | 'staff' }

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'diver-1' },
    profile: { id: 'diver-1', role: authState.role },
    loading: false,
  }),
}))

const pastEvent = {
  id: 'event-1',
  type: 'dive',
  title: 'Longdong shore dive',
  start_time: '2026-08-01T01:00:00Z',
  end_time: null,
  start_time_hhmm: '09:00',
}

const sameDayEvent = { ...pastEvent, id: 'event-2', title: 'Longdong boat dive' }

vi.mock('../lib/events', () => ({
  fetchEventsInRange: vi.fn(async () => [pastEvent, sameDayEvent]),
  formatEventSpan: () => 'Sat, Aug 1',
  isPastEvent: () => true,
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
  event_id: 'event-1',
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

const pendingRecord = { ...approvedRecord, id: 'record-2', event_title: 'Longdong shore dive' }

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

  it('fetches every event\'s approved records in one request', async () => {
    mockRpc({ almanac_records_for_events: [approvedRecord] })
    renderPage()

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('almanac_records_for_events', {
      p_event_ids: ['event-1', 'event-2'],
    }))
    expect(rpc.mock.calls.filter(c => c[0] === 'almanac_records_for_events')).toHaveLength(1)
    expect(await screen.findByText(t.almanac.recordsHeading)).toBeInTheDocument()
  })

  it('groups the history by calendar date, merging events that share a day', async () => {
    const user = userEvent.setup()
    mockRpc({
      almanac_records_for_events: [
        approvedRecord,
        { ...approvedRecord, id: 'record-3', event_id: 'event-2', diver_display: 'Jun' },
        { ...approvedRecord, id: 'record-4', obs_date: '2026-07-30' },
      ],
    })
    renderPage()

    const days = await screen.findAllByText(/Aug 1, 2026|Jul 30, 2026/)
    expect(days).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: /Aug 1, 2026/ }))
    expect(screen.getByText('Longdong shore dive')).toBeInTheDocument()
    expect(screen.getByText('Longdong boat dive')).toBeInTheDocument()
    expect(screen.getByText(t.almanac.observationCount(2))).toBeInTheDocument()
  })

  it('submits the form through the RPC, parsing numbers and wildlife', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.selectOptions(screen.getByLabelText(t.almanac.event), 'event-1')
    await user.type(screen.getByLabelText(t.almanac.airTemp), '29.5')
    await user.type(screen.getByLabelText(t.almanac.wildlife), 'turtle, manta ray')
    await user.click(screen.getByRole('button', { name: t.almanac.submitRecord }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('submit_almanac_record',
      expect.objectContaining({
        p_event_id: 'event-1',
        p_air_temp_c: 29.5,
        p_water_temp_c: null,
        p_wildlife: ['turtle', 'manta ray'],
      })))
    expect(await screen.findByText(t.almanac.submitted)).toBeInTheDocument()
  })

  it('surfaces a failed submission instead of reporting success', async () => {
    const user = userEvent.setup()
    rpc.mockImplementation(async (name: string) =>
      name === 'submit_almanac_record'
        ? { data: null, error: { message: 'permission denied' } }
        : { data: [], error: null })
    renderPage()
    await screen.findByRole('button', { name: t.almanac.submitRecord })

    await user.selectOptions(screen.getByLabelText(t.almanac.event), 'event-1')
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
