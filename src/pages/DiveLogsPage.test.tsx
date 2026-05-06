import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DiveLogsPage } from './DiveLogsPage'
import type { DiveLog } from '../types/database'

// useAuth is mocked so we get a stable user id without mounting AuthProvider.
const useAuthMock = vi.fn()
vi.mock('../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

// Mock the data layer directly. Component tests use this style elsewhere
// (notifications, profile) — we keep RLS / DB-shape concerns in the
// integration tests and exercise the page logic in isolation here.
const fetchDiveLogsMock        = vi.fn()
const createDiveLogMock        = vi.fn()
const updateDiveLogMock        = vi.fn()
const deleteDiveLogMock        = vi.fn()
const getLastExportMock        = vi.fn()
const requestExportMock        = vi.fn()
vi.mock('../lib/dive-logs', async () => {
  const actual = await vi.importActual<typeof import('../lib/dive-logs')>('../lib/dive-logs')
  return {
    ...actual,
    fetchDiveLogs:           (...a: unknown[]) => fetchDiveLogsMock(...a),
    createDiveLog:           (...a: unknown[]) => createDiveLogMock(...a),
    updateDiveLog:           (...a: unknown[]) => updateDiveLogMock(...a),
    deleteDiveLog:           (...a: unknown[]) => deleteDiveLogMock(...a),
    getLastExportRequestAt:  (...a: unknown[]) => getLastExportMock(...a),
    requestExport:           (...a: unknown[]) => requestExportMock(...a),
  }
})

beforeEach(() => {
  useAuthMock.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'u1' } })
  fetchDiveLogsMock.mockReset()
  createDiveLogMock.mockReset()
  updateDiveLogMock.mockReset()
  deleteDiveLogMock.mockReset()
  getLastExportMock.mockReset()
  requestExportMock.mockReset()

  // Default to "no exports requested yet" so the export button is enabled.
  getLastExportMock.mockResolvedValue(null)
  fetchDiveLogsMock.mockResolvedValue([])
})

function renderPage() {
  return render(<MemoryRouter><DiveLogsPage /></MemoryRouter>)
}

const sampleRow = (overrides: Partial<DiveLog> = {}): DiveLog => ({
  id:                'd1',
  user_id:           'u1',
  dive_number:       1,
  dived_on:          '2026-04-30',
  site:              '蘭嶼東清灣',
  dive_type:         'shore',
  max_depth_m:       18.5,
  dive_time_min:     45,
  visibility_m:      15,
  water_temp_c:      26,
  air_temp_c:        29,
  weather:           'Sunny',
  wave_height_m:     0.5,
  weight_kg:         5,
  gear_used:         ['BCD', 'Wetsuit'],
  gas_mix:           'air',
  tank_size_l:       12,
  start_pressure_bar: 200,
  end_pressure_bar:   60,
  buddy_name:        'Alice',
  instructor_name:   null,
  notes:             'Saw a turtle',
  created_at:        '2026-04-30T08:00:00Z',
  updated_at:        '2026-04-30T08:00:00Z',
  ...overrides,
})

describe('DiveLogsPage list view', () => {
  it('renders an empty-state when the diver has no logged dives yet', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/no logged dives yet/i)).toBeInTheDocument())
  })

  it('renders a row per dive log with number, site, and headline stats', async () => {
    fetchDiveLogsMock.mockResolvedValue([
      sampleRow({ id: 'a', dive_number: 2, site: 'Wai-ao', max_depth_m: 22, dive_time_min: 50 }),
      sampleRow({ id: 'b', dive_number: 1, site: '蘭嶼東清灣', max_depth_m: 18.5, dive_time_min: 45 }),
    ])
    renderPage()
    const item1 = await screen.findByRole('button', { name: /edit dive 2 .* Wai-ao/i })
    expect(within(item1).getByText(/22 m max/)).toBeInTheDocument()
    expect(within(item1).getByText(/50 min/)).toBeInTheDocument()
    const item2 = await screen.findByRole('button', { name: /edit dive 1 .* 蘭嶼東清灣/i })
    expect(within(item2).getByText(/18.5 m max/)).toBeInTheDocument()
  })

  it('preserves multilingual / non-ASCII site names verbatim — site is free-text by design', async () => {
    fetchDiveLogsMock.mockResolvedValue([
      sampleRow({ site: '蘭嶼東清灣' }),
    ])
    renderPage()
    expect(await screen.findByText(/蘭嶼東清灣/)).toBeInTheDocument()
  })
})

describe('DiveLogsPage add flow', () => {
  it('clicking + Add opens an empty form, saving inserts and returns to list', async () => {
    fetchDiveLogsMock.mockResolvedValue([])
    createDiveLogMock.mockResolvedValue(sampleRow({ id: 'new', dive_number: 1, site: 'Test Site' }))
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /\+ add/i }))
    expect(screen.getByText(/new dive/i)).toBeInTheDocument()

    // Date defaults to today; site is required and starts empty.
    const siteInput = screen.getAllByDisplayValue('').find(el => el.tagName === 'INPUT' && el.getAttribute('type') === 'text')!
    await user.type(siteInput, 'Test Site')
    await user.click(screen.getByRole('button', { name: /save dive/i }))

    await waitFor(() => expect(createDiveLogMock).toHaveBeenCalledOnce())
    const arg = createDiveLogMock.mock.calls[0][0]
    expect(arg.site).toBe('Test Site')
    expect(arg.user_id).toBe('u1')
    // dive_number is intentionally omitted so the DB trigger assigns it per-user.
    expect(arg.dive_number).toBeUndefined()

    // Returns to list view with the new row visible.
    await waitFor(() => expect(screen.getByRole('button', { name: /edit dive 1 .* Test Site/i })).toBeInTheDocument())
  })

  it('does NOT call createDiveLog when the required Site field is empty', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /\+ add/i }))

    // Native <input required> blocks form submit. We click Save and assert
    // no API call was made — the form stays open.
    await user.click(screen.getByRole('button', { name: /save dive/i }))
    expect(createDiveLogMock).not.toHaveBeenCalled()
    expect(screen.getByText(/new dive/i)).toBeInTheDocument()
  })
})

describe('DiveLogsPage edit + delete flow', () => {
  it('clicking a row opens the form pre-filled, save calls update', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 7, site: 'Original' })
    fetchDiveLogsMock.mockResolvedValue([row])
    updateDiveLogMock.mockResolvedValue({ ...row, site: 'Edited' })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /edit dive 7 .* Original/i }))

    expect(screen.getByText(/dive #7/i)).toBeInTheDocument()
    const siteInput = screen.getByDisplayValue('Original') as HTMLInputElement
    // fireEvent.change rather than user.clear+type — happy-dom's input clear
    // semantics interact badly with React controlled inputs in this form,
    // and a single change event is closer to what the user is doing anyway
    // (paste / programmatic edit).
    fireEvent.change(siteInput, { target: { value: 'Edited' } })
    // happy-dom doesn't always bubble a form submit from a button-click
    // synthesized via user.click in this complex form (many controlled
    // inputs). Submitting the form element directly is equivalent and
    // avoids the flake without changing what we're asserting.
    fireEvent.submit(siteInput.closest('form')!)

    await waitFor(() => expect(updateDiveLogMock).toHaveBeenCalledOnce())
    expect(updateDiveLogMock.mock.calls[0]).toEqual(['r1', expect.objectContaining({ site: 'Edited' })])
  })

  it('Delete button is hidden in the new-dive form (no row to delete yet)', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /\+ add/i }))
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
  })

  it('Delete confirms then calls deleteDiveLog and returns to the list', async () => {
    const row = sampleRow()
    fetchDiveLogsMock.mockResolvedValue([row])
    deleteDiveLogMock.mockResolvedValue(undefined)
    const confirmSpy = vi.fn().mockReturnValue(true)
    window.confirm = confirmSpy
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: new RegExp(`edit dive ${row.dive_number}.*${row.site}`, 'i') }))
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(confirmSpy).toHaveBeenCalled()
    await waitFor(() => expect(deleteDiveLogMock).toHaveBeenCalledWith(row.id))
    delete (window as unknown as { confirm?: unknown }).confirm
  })

  it('Delete is a no-op when the user cancels the native confirm', async () => {
    fetchDiveLogsMock.mockResolvedValue([sampleRow()])
    const confirmSpy = vi.fn().mockReturnValue(false)
    window.confirm = confirmSpy
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /edit dive/i }))
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(deleteDiveLogMock).not.toHaveBeenCalled()
    delete (window as unknown as { confirm?: unknown }).confirm
  })
})

describe('DiveLogsPage CSV export', () => {
  it('disables the export button with no dive logs (nothing to send)', async () => {
    fetchDiveLogsMock.mockResolvedValue([])
    renderPage()
    const btn = await screen.findByRole('button', { name: /email me a csv/i })
    expect(btn).toBeDisabled()
    expect(screen.getByText(/no dives to export yet/i)).toBeInTheDocument()
  })

  it('shows the row count in the prompt copy when there are dives to export', async () => {
    fetchDiveLogsMock.mockResolvedValue([sampleRow(), sampleRow({ id: '2', dive_number: 2 })])
    renderPage()
    expect(await screen.findByText(/export all 2 dives as a csv/i)).toBeInTheDocument()
  })

  it('clicking Email me a CSV calls requestExport and toasts success', async () => {
    fetchDiveLogsMock.mockResolvedValue([sampleRow()])
    requestExportMock.mockResolvedValue({ ok: true, dive_count: 1 })
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /email me a csv/i }))
    await waitFor(() => expect(requestExportMock).toHaveBeenCalledOnce())

    // Optimistic 24h disable kicks in after success — the page now shows a
    // countdown card instead of the active button.
    await waitFor(() => expect(screen.getByText(/csv export available in/i)).toBeInTheDocument())
  })

  it('renders disabled-with-countdown when an export was requested in the last 24h', async () => {
    // Last requested 4h ago -> ~20h until next available.
    const fourHoursAgo = new Date(Date.now() - 4 * 3600 * 1000)
    getLastExportMock.mockResolvedValue(fourHoursAgo)
    fetchDiveLogsMock.mockResolvedValue([sampleRow()])
    renderPage()

    await waitFor(() => expect(screen.getByText(/csv export available in/i)).toBeInTheDocument())
    // Button still rendered, but disabled — clicking does nothing.
    const btn = screen.getByRole('button', { name: /email me a csv/i })
    expect(btn).toBeDisabled()
  })

  it('rate-limited error from the server flips the UI into the countdown state', async () => {
    fetchDiveLogsMock.mockResolvedValue([sampleRow()])
    requestExportMock.mockRejectedValue(new Error('rate-limited'))
    // Server says: last request was 1h ago.
    getLastExportMock
      .mockResolvedValueOnce(null)                                     // initial mount
      .mockResolvedValueOnce(new Date(Date.now() - 1 * 3600 * 1000))   // re-sync after rate-limit
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /email me a csv/i }))
    await waitFor(() => expect(screen.getByText(/csv export available in/i)).toBeInTheDocument())
  })
})
