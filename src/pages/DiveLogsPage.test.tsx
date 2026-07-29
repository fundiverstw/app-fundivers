import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DiveLogsPage } from './DiveLogsPage'
import type { DiveLog } from '../types/database'
import { todayIso } from '../lib/dates'

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
  title:             null,
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
  notes:             'Saw a turtle',
  created_at:        '2026-04-30T08:00:00Z',
  updated_at:        '2026-04-30T08:00:00Z',
  ...overrides,
})

// A new dive opens with only the required boxes — date, site, max depth, dive
// time and a buddy/instructor. Everything else is pulled in from the picker.
function fillRequired(site = 'Test Site') {
  fireEvent.change(screen.getByLabelText(/site/i), { target: { value: site } })
  fireEvent.change(screen.getByLabelText(/max depth/i), { target: { value: '18' } })
  fireEvent.change(screen.getByLabelText(/dive time/i), { target: { value: '42' } })
  fireEvent.change(screen.getByLabelText(/^buddy \/ instructor/i), { target: { value: 'Alice' } })
}

function addOptionalField(label: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name: /\+ add field/i }))
  const picker = screen.getByRole('group', { name: /fields you can add/i })
  fireEvent.click(within(picker).getByRole('button', { name: label }))
}

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

  it('shows the dive title as the card heading, with #number · site beneath it', async () => {
    fetchDiveLogsMock.mockResolvedValue([
      sampleRow({ title: 'Manta cleaning station', dive_number: 12, site: 'Green Island' }),
    ])
    renderPage()
    expect(await screen.findByText('Manta cleaning station')).toBeInTheDocument()
    expect(screen.getByText(/#12 · Green Island/)).toBeInTheDocument()
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

    // Date defaults to today; the rest of the required set starts empty.
    fillRequired()
    await user.click(screen.getByRole('button', { name: /save dive/i }))

    await waitFor(() => expect(createDiveLogMock).toHaveBeenCalledOnce())
    const arg = createDiveLogMock.mock.calls[0][0]
    expect(arg.site).toBe('Test Site')
    expect(arg.user_id).toBe('u1')
    // The pre-filled dive # was left unchanged, so it's omitted and the DB
    // trigger assigns it per-user.
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

  it('sends an explicit dive number when the diver overrides the pre-filled one', async () => {
    // No prior dives → the field pre-fills 1; the diver arriving with an
    // existing logbook overwrites it to start their count at 247.
    fetchDiveLogsMock.mockResolvedValue([])
    createDiveLogMock.mockResolvedValue(sampleRow({ id: 'new', dive_number: 247, site: 'Test Site' }))
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /\+ add/i }))

    fillRequired()
    const numberInput = screen.getByLabelText(/^dive #/i)
    await user.clear(numberInput)
    await user.type(numberInput, '247')
    await user.click(screen.getByRole('button', { name: /save dive/i }))

    await waitFor(() => expect(createDiveLogMock).toHaveBeenCalledOnce())
    expect(createDiveLogMock.mock.calls[0][0].dive_number).toBe(247)
  })

  it('saves a user-set dive title', async () => {
    fetchDiveLogsMock.mockResolvedValue([])
    createDiveLogMock.mockResolvedValue(sampleRow({ id: 'new', dive_number: 1, site: 'Test Site', title: 'Manta night dive' }))
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: /\+ add/i }))

    fillRequired()
    await user.type(screen.getByLabelText(/^dive name$/i), 'Manta night dive')
    await user.click(screen.getByRole('button', { name: /save dive/i }))

    await waitFor(() => expect(createDiveLogMock).toHaveBeenCalledOnce())
    expect(createDiveLogMock.mock.calls[0][0].title).toBe('Manta night dive')
  })

  it('blocks a duplicate dive number with a friendly error and does not insert', async () => {
    fetchDiveLogsMock.mockResolvedValue([sampleRow({ id: 'a', dive_number: 5, site: 'Old' })])
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: /edit dive 5/i })
    await user.click(screen.getByRole('button', { name: /\+ add/i }))

    fillRequired('New Site')
    const numberInput = screen.getByLabelText(/^dive #/i)
    await user.clear(numberInput)
    await user.type(numberInput, '5')
    await user.click(screen.getByRole('button', { name: /save dive/i }))

    expect(await screen.findByText(/already have a dive #5/i)).toBeInTheDocument()
    expect(createDiveLogMock).not.toHaveBeenCalled()
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

describe('DiveLogsPage field validation', () => {
  async function openEditForm(row: DiveLog) {
    fetchDiveLogsMock.mockResolvedValue([row])
    renderPage()
    const trigger = await screen.findByRole('button', {
      name: new RegExp(`edit dive ${row.dive_number}`, 'i'),
    })
    fireEvent.click(trigger)
    return screen.getByDisplayValue(row.site).closest('form') as HTMLFormElement
  }

  it('refuses to save a value the column cannot hold, and names the field', async () => {
    // The reported bug: 999 in water temp is a numeric(3,1) overflow, which
    // used to surface as the raw Postgres "numeric field overflow".
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Overflow' })
    const form = await openEditForm(row)

    fireEvent.change(screen.getByDisplayValue('26'), { target: { value: '999' } })
    fireEvent.submit(form)

    expect(updateDiveLogMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/must be between -2 and 40/i)).toBeInTheDocument()
  })

  it('bounds every numeric input in the DOM so the browser blocks it first', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Bounded' })
    const form = await openEditForm(row)

    const numbers = within(form).getAllByRole('spinbutton')
    expect(numbers.length).toBeGreaterThan(0)
    for (const input of numbers) {
      expect(input).toHaveAttribute('min')
      expect(input).toHaveAttribute('max')
    }
  })

  it('clears a field complaint as soon as the diver edits it', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Retract' })
    const form = await openEditForm(row)

    fireEvent.change(screen.getByDisplayValue('26'), { target: { value: '999' } })
    fireEvent.submit(form)
    expect(await screen.findByText(/must be between -2 and 40/i)).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('999'), { target: { value: '27' } })
    await waitFor(() => expect(screen.queryByText(/must be between -2 and 40/i)).not.toBeInTheDocument())
  })

  it('rejects a tank that came back fuller than it went in', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Backwards' })
    const form = await openEditForm(row)

    fireEvent.change(screen.getByDisplayValue('60'), { target: { value: '250' } })
    fireEvent.submit(form)

    expect(updateDiveLogMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/end pressure cannot be higher/i)).toBeInTheDocument()
  })

  it('rounds a too-precise number to what the column stores', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Rounded' })
    updateDiveLogMock.mockResolvedValue(row)
    const form = await openEditForm(row)

    fireEvent.change(screen.getByDisplayValue('18.5'), { target: { value: '18.549' } })
    fireEvent.submit(form)

    await waitFor(() => expect(updateDiveLogMock).toHaveBeenCalledOnce())
    expect(updateDiveLogMock.mock.calls[0][1]).toMatchObject({ max_depth_m: 18.5 })
  })
})

describe('DiveLogsPage buddy / instructor', () => {
  it('shows the name on the list row', async () => {
    fetchDiveLogsMock.mockResolvedValue([
      sampleRow({ id: 'a', dive_number: 4, site: 'Batcave', buddy_name: 'Alice' }),
    ])
    renderPage()
    const item = await screen.findByRole('button', { name: /edit dive 4/i })
    expect(within(item).getByText(/Alice/)).toBeInTheDocument()
  })

  it('omits the name when the dive does not have one', async () => {
    fetchDiveLogsMock.mockResolvedValue([
      sampleRow({ id: 'a', dive_number: 4, site: 'Solo', buddy_name: null }),
    ])
    renderPage()
    const item = await screen.findByRole('button', { name: /edit dive 4/i })
    expect(within(item).queryByText(/w\//)).not.toBeInTheDocument()
  })

  it('round-trips the name through the edit form', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 5, site: 'Names', buddy_name: null })
    fetchDiveLogsMock.mockResolvedValue([row])
    updateDiveLogMock.mockResolvedValue(row)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /edit dive 5/i }))

    const form = screen.getByDisplayValue('Names').closest('form') as HTMLFormElement
    fireEvent.change(within(form).getByLabelText(/^buddy \/ instructor/i), { target: { value: 'Alice' } })
    fireEvent.submit(form)

    await waitFor(() => expect(updateDiveLogMock).toHaveBeenCalledOnce())
    expect(updateDiveLogMock.mock.calls[0][1]).toMatchObject({ buddy_name: 'Alice' })
  })
})

describe('DiveLogsPage required fields', () => {
  async function openNewForm() {
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
    return screen.getByRole('button', { name: /save dive/i }).closest('form') as HTMLFormElement
  }

  it('names every missing requirement at once rather than one at a time', async () => {
    const form = await openNewForm()
    fireEvent.change(screen.getByLabelText(/site/i), { target: { value: 'Somewhere' } })
    fireEvent.submit(form)

    expect(createDiveLogMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/enter your max depth/i)).toBeInTheDocument()
    expect(screen.getByText(/enter how long the dive was/i)).toBeInTheDocument()
    expect(screen.getByText(/enter who you dived with/i)).toBeInTheDocument()
  })

  it('saves once whoever the dive was with is named', async () => {
    createDiveLogMock.mockResolvedValue(sampleRow({ id: 'new' }))
    const form = await openNewForm()
    fireEvent.change(screen.getByLabelText(/site/i), { target: { value: 'Somewhere' } })
    fireEvent.change(screen.getByLabelText(/max depth/i), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText(/dive time/i), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText(/^buddy \/ instructor/i), { target: { value: 'Bob' } })
    fireEvent.submit(form)

    await waitFor(() => expect(createDiveLogMock).toHaveBeenCalledOnce())
  })

  it('treats zero depth as an answer, not a blank', async () => {
    createDiveLogMock.mockResolvedValue(sampleRow({ id: 'new' }))
    const form = await openNewForm()
    fillRequired()
    fireEvent.change(screen.getByLabelText(/max depth/i), { target: { value: '0' } })
    fireEvent.submit(form)

    await waitFor(() => expect(createDiveLogMock).toHaveBeenCalledOnce())
    expect(createDiveLogMock.mock.calls[0][0].max_depth_m).toBe(0)
  })

  it('leaves the decimal boxes free of a step, so an over-precise entry rounds instead of being blocked', async () => {
    // step="0.1" makes the browser reject 18.55 with a native tooltip, and
    // roundDiveLogNumbers never gets to snap it to what the column holds.
    const form = await openNewForm()
    const depth = within(form).getByLabelText(/max depth/i)
    expect(depth).toHaveAttribute('step', 'any')
    expect(within(form).getByLabelText(/dive time/i)).toHaveAttribute('step', '1')
  })
})

describe('DiveLogsPage optional fields', () => {
  it('opens a new dive with the core boxes and nothing else', async () => {
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))

    expect(screen.getByLabelText(/site/i)).toBeInTheDocument()
    // Name and number are optional but always on the form: the name is the
    // card's heading and the number is what the logbook is ordered by, so
    // burying either in the picker made them look unsettable.
    expect(screen.getByLabelText(/^dive name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^dive #/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^notes$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^visibility/i)).not.toBeInTheDocument()
  })

  it('adds a field from the picker and drops it from the remaining list', async () => {
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))

    addOptionalField(/^visibility \(m\)$/i)
    expect(screen.getByLabelText(/^visibility/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /\+ add field/i }))
    const picker = screen.getByRole('group', { name: /fields you can add/i })
    expect(within(picker).queryByRole('button', { name: /^visibility \(m\)$/i })).not.toBeInTheDocument()
  })

  it('shows the fields an existing dive already carries', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Full', notes: 'Saw a turtle' })
    fetchDiveLogsMock.mockResolvedValue([row])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /edit dive 3/i }))

    expect(screen.getByDisplayValue('Saw a turtle')).toBeInTheDocument()
  })

  it('removing a field clears the value rather than hiding it with data still attached', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Trim', notes: 'Saw a turtle' })
    fetchDiveLogsMock.mockResolvedValue([row])
    updateDiveLogMock.mockResolvedValue(row)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /edit dive 3/i }))
    const form = screen.getByDisplayValue('Trim').closest('form') as HTMLFormElement

    fireEvent.click(screen.getByRole('button', { name: /remove notes/i }))
    expect(screen.queryByDisplayValue('Saw a turtle')).not.toBeInTheDocument()
    fireEvent.submit(form)

    await waitFor(() => expect(updateDiveLogMock).toHaveBeenCalledOnce())
    expect(updateDiveLogMock.mock.calls[0][1]).toMatchObject({ notes: null })
  })

  it('hides the picker once every field is on the form', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Everything', title: 'Named' })
    fetchDiveLogsMock.mockResolvedValue([row])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /edit dive 3/i }))

    // Every optional column on this row carries a value, so there is nothing
    // left to offer.
    expect(screen.queryByRole('button', { name: /\+ add field/i })).not.toBeInTheDocument()
  })
})

describe('DiveLogsPage mobile layout', () => {
  it('spans wide rows across the explicit grid, never a hardcoded 2 columns', async () => {
    // The form grid is one column on mobile. `col-span-2` there makes CSS Grid
    // create an implicit second track, which collapses the real `minmax(0,1fr)`
    // column to near zero — and with `overflow-wrap: break-word` on body, every
    // caption then renders one letter per line. `col-span-full` spans only the
    // explicit grid, so it stays one column until the sm breakpoint.
    fetchDiveLogsMock.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))

    const form = screen.getByRole('button', { name: /save dive/i }).closest('form')!
    expect(form.querySelectorAll('[class*="col-span-2"]')).toHaveLength(0)
    expect(form.querySelectorAll('[class*="col-span-full"]').length).toBeGreaterThan(0)
  })
})

describe('DiveLogsPage dates and labels', () => {
  it("defaults a new dive to the shop's today, not UTC's", async () => {
    // The UTC-vs-shop-timezone difference is pinned in dates.test.ts, where it
    // can use fake timers safely. Here we only need the form to be reading the
    // shop-aware helper rather than slicing toISOString().
    fetchDiveLogsMock.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
    expect(screen.getByPlaceholderText('YYYY-MM-DD')).toHaveValue(todayIso())
  })

  it('renders the stored calendar day without a timezone shift', async () => {
    // new Date('2026-04-30') is UTC midnight, which formats as the 29th in any
    // timezone behind Greenwich.
    fetchDiveLogsMock.mockResolvedValue([sampleRow({ dive_number: 9, dived_on: '2026-04-30' })])
    renderPage()
    const item = await screen.findByRole('button', { name: /edit dive 9/i })
    expect(within(item).getByText(/Apr 30, 2026/)).toBeInTheDocument()
  })

  it('refuses a mistyped year', async () => {
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Mistyped' })
    fetchDiveLogsMock.mockResolvedValue([row])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /edit dive 3/i }))
    const form = screen.getByDisplayValue('Mistyped').closest('form') as HTMLFormElement

    fireEvent.change(screen.getByPlaceholderText('YYYY-MM-DD'), { target: { value: '9999-04-30' } })
    fireEvent.submit(form)

    expect(updateDiveLogMock).not.toHaveBeenCalled()
    expect(await screen.findByText(/check the year/i)).toBeInTheDocument()
  })

  it('labels the dive-type and gas-mix options instead of showing raw column values', async () => {
    fetchDiveLogsMock.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(fetchDiveLogsMock).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /\+ add/i }))
    addOptionalField(/^type$/i)

    const type = screen.getByLabelText(/^type$/i)
    expect(within(type).getByRole('option', { name: 'Shore' })).toBeInTheDocument()
    expect(within(type).queryByRole('option', { name: 'shore' })).not.toBeInTheDocument()
    // The stored value stays the raw enum — only the caption is translated.
    expect(within(type).getByRole('option', { name: 'Shore' })).toHaveValue('shore')
  })

  it('keeps a gear item the shop has since removed togglable', async () => {
    // toggleGear preserves unrecognised entries, so without this the item was
    // stuck on the dive with no button to clear it.
    const row = sampleRow({ id: 'r1', dive_number: 3, site: 'Legacy', gear_used: ['Rebreather'] })
    fetchDiveLogsMock.mockResolvedValue([row])
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /edit dive 3/i }))

    const button = screen.getByRole('button', { name: 'Rebreather', pressed: true })
    expect(button).toBeInTheDocument()
  })
})
