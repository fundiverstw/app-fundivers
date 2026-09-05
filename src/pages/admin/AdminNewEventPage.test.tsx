import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { siteConfig } from '../../config/site'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminNewEventPage } from './AdminNewEventPage'
import { mockQueryBuilder, getDateInputByLabel } from '../../../tests/test-utils'

const { from, rpc, createDiveSite, findSimilarDiveSites } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  createDiveSite: vi.fn(),
  findSimilarDiveSites: vi.fn(),
}))
vi.mock('../../lib/dive-sites', async () => {
  const actual = await vi.importActual<typeof import('../../lib/dive-sites')>('../../lib/dive-sites')
  return {
    ...actual,
    createDiveSite: (...a: unknown[]) => createDiveSite(...a),
    findSimilarDiveSites: (...a: unknown[]) => findSimilarDiveSites(...a),
  }
})
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', role: 'admin' } }),
}))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
  createDiveSite.mockReset()
  findSimilarDiveSites.mockReset()
  findSimilarDiveSites.mockResolvedValue([])
  // create_events_with_relations writes the event, its junctions and its cars in
  // one transaction, returning the new ids.
  rpc.mockResolvedValue({ data: ['new-event-1'], error: null })
})

function fakeCatalog() {
  // The page fetches three catalog tables on mount before submit is enabled.
  // Hand each lookup a tiny fixture so the FK pickers actually render rows.
  from.mockImplementation((table: string) => {
    if (table === 'prices') return mockQueryBuilder({ data: [{ id: 'price-1', title: 'Standard',  starting_at: 5000 }] })
    if (table === 'rooms')  return mockQueryBuilder({ data: [{ id: 'room-1',  display_title: 'Twin', admin_title: 'Twin' }] })
    if (table === 'addons') return mockQueryBuilder({ data: [{ id: 'addon-1', display_title: 'Nitrox', admin_title: 'Nitrox' }] })
    return mockQueryBuilder({ data: [] })
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/new']}>
      <Routes>
        <Route path="/admin/new"               element={<AdminNewEventPage />} />
        <Route path="/admin/events/:id" element={<div>EVENT_DETAIL</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminNewEventPage', () => {
  it('defaults to dive type and exposes the dive-only sections', async () => {
    fakeCatalog()
    renderPage()
    expect(await screen.findByRole('heading', { name: /new event/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/admin title \(required, internal\)/i)).toBeInTheDocument()
    expect(screen.getByText(/dive details/i)).toBeInTheDocument()
    // Course-only sections should be absent
    expect(screen.queryByText(/course details/i)).not.toBeInTheDocument()
  })

  it('switches to course mode when the course pill is clicked', async () => {
    fakeCatalog()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Course' }))
    expect(screen.getByLabelText(/admin title \(internal\)/i)).toBeInTheDocument()
    expect(screen.getByText(/course details/i)).toBeInTheDocument()
    expect(screen.queryByText(/dive details/i)).not.toBeInTheDocument()
  })

  it('blocks submit when dive title is missing', async () => {
    fakeCatalog()
    const user = userEvent.setup()
    renderPage()
    // Browser form validation kicks in before our handler — fill start_date so
    // the admin_title required attribute is the only thing left.
    await screen.findByLabelText(/admin title \(required, internal\)/i)
    await user.click(screen.getByRole('button', { name: /create dive/i }))
    // We never navigated, so the new-event heading is still visible.
    expect(screen.getByRole('heading', { name: /new event/i })).toBeInTheDocument()
  })

  it('preloads form fields when a past dive is picked', async () => {
    const pastDive = {
      id: 'past-1',
      kind: 'dive',
      admin_title: 'Green Island Day Trip',
      start_date: '2026-01-15',
      start_time: '09:00:00',
      end_date: '2026-01-15',
      notes: 'Bring fins',
      featured: true,
      fully_booked: false,
      nitrox_required: true,
      price: 'price-1',
    }
    from.mockImplementation((table: string) => {
      if (table === 'prices')    return mockQueryBuilder({ data: [{ id: 'price-1', title: 'Standard' }] })
      if (table === 'rooms')     return mockQueryBuilder({ data: [] })
      if (table === 'addons') return mockQueryBuilder({ data: [] })
      // Dives + courses are one `events` table now, queried twice by kind; the
      // course-kind read maps the same row but drops it (no course_days).
      if (table === 'events') {
        const b = mockQueryBuilder({ data: [pastDive] })
        // The picker fetches only enough columns to label its rows, then pulls
        // the full event by id once one is picked — so `.single()` has to hand
        // back the row itself, not the list.
        b.single = () => Promise.resolve({ data: pastDive, error: null })
        return b
      }
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByLabelText(/preload from past dive/i) as HTMLSelectElement
    await user.selectOptions(select, 'past-1')
    expect((screen.getByLabelText(/admin title \(required, internal\)/i) as HTMLInputElement).value).toBe('Green Island Day Trip')
    expect((getDateInputByLabel(/start date/i) as HTMLInputElement).value).toBe('2026-01-15')
    expect((screen.getByLabelText(/start time/i) as HTMLInputElement).value).toBe('09:00')
    expect((screen.getByLabelText(/notes/i) as HTMLTextAreaElement).value).toBe('Bring fins')
    expect((screen.getByLabelText(/^featured$/i) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/nitrox required/i) as HTMLInputElement).checked).toBe(true)
  })

  it('offers only the most recent trip to each dive location in the preload picker', async () => {
    // admin_title is the site for a dive — the shop returns to Long Dong Bay
    // constantly, and only the newest trip is worth preloading from.
    const dive = (id: string, adminTitle: string, startDate: string) => ({
      id, kind: 'dive', admin_title: adminTitle, display_title: adminTitle,
      start_date: startDate, course_days: null,
    })
    const dives = [
      dive('ldb-jan', 'Long Dong Bay', '2026-01-18'),
      dive('ldb-may', 'Long Dong Bay', '2026-05-03'),
      dive('penghu',  'Penghu',        '2026-05-15'),
    ]
    from.mockImplementation((table: string) => {
      if (table !== 'events') return mockQueryBuilder({ data: [] })
      let kinds: string[] = []
      const b = mockQueryBuilder({ data: [] })
      b.in = (col: string, vals: string[]) => { if (col === 'kind') kinds = vals; return b }
      b.then = (cb?: (r: unknown) => unknown) =>
        Promise.resolve({ data: kinds.includes('dive') ? dives : [], error: null }).then(cb)
      return b
    })
    renderPage()

    const select = await screen.findByLabelText(/preload from past dive/i) as HTMLSelectElement
    const labels = [...select.options].map(o => o.textContent ?? '')

    expect(labels.filter(l => l.includes('Long Dong Bay'))).toHaveLength(1)
    expect(labels.some(l => l.includes('2026-05-03'))).toBe(true)
    expect(labels.some(l => l.includes('2026-01-18'))).toBe(false)
    expect(labels.some(l => l.includes('Penghu'))).toBe(true)
  })

  it('offers only the most recent run of each course type in the preload picker', async () => {
    // The shop repeats the same handful of courses, so listing every past
    // offering made this dropdown unusable.
    const course = (id: string, adminTitle: string, days: string[]) => ({
      id, kind: 'course', admin_title: adminTitle, display_title: adminTitle,
      start_date: null, course_days: days,
    })
    const courses = [
      course('ow-old', 'OW',  ['2026-01-10', '2026-01-11']),
      course('ow-new', 'OW',  ['2026-05-17', '2026-05-18']),
      course('aow',    'AOW', ['2026-03-02']),
    ]
    from.mockImplementation((table: string) => {
      if (table !== 'events') return mockQueryBuilder({ data: [] })
      // The form runs two reads against `events`, split by temporal shape.
      // Honour the kind filter here or the course rows also come back from the
      // envelope read, which does not collapse by course type.
      let kinds: string[] = []
      const b = mockQueryBuilder({ data: [] })
      b.in = (col: string, vals: string[]) => { if (col === 'kind') kinds = vals; return b }
      b.then = (cb?: (r: unknown) => unknown) =>
        Promise.resolve({ data: kinds.includes('course') ? courses : [], error: null }).then(cb)
      return b
    })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /^course$/i }))
    const select = await screen.findByLabelText(/preload from past course/i) as HTMLSelectElement
    const labels = [...select.options].map(o => o.textContent ?? '')

    // One entry per course type, plus the "start fresh" placeholder.
    expect(labels.filter(l => l.includes('OW') && !l.includes('AOW'))).toHaveLength(1)
    expect(labels.some(l => l.includes('2026-05-17'))).toBe(true)
    expect(labels.some(l => l.includes('2026-01-10'))).toBe(false)
    expect(labels.some(l => l.includes('AOW'))).toBe(true)
  })

  it('inserts a new price tier from the sub-form and auto-selects it', async () => {
    const priceInsert = vi.fn().mockReturnValue({
      then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb),
    })
    from.mockImplementation((table: string) => {
      if (table === 'prices') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = priceInsert
        return b
      }
      if (table === 'rooms')     return mockQueryBuilder({ data: [{ id: 'room-1', display_title: 'Twin', admin_title: 'Twin' }] })
      if (table === 'addons') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)
    await user.click(screen.getByRole('button', { name: /new price tier/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'Premium')
    await user.type(screen.getByLabelText('Starting at'), '15000')
    await user.click(screen.getByRole('button', { name: /save price tier/i }))
    await waitFor(() => expect(priceInsert).toHaveBeenCalled())
    const payload = (priceInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.admin_title).toBe('Premium')
    expect(payload.starting_at).toBe(15000)
    // Newly created tier becomes the selected option in the price dropdown.
    await waitFor(() => {
      const select = screen.getByLabelText(/price tier/i) as HTMLSelectElement
      expect(select.value).toBe(payload.id as string)
      expect(select.options[select.selectedIndex].textContent).toMatch(/Premium/)
    })
  })

  it('inserts a new room option from the sub-form and auto-ticks it', async () => {
    const roomInsert = vi.fn().mockReturnValue({
      then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb),
    })
    from.mockImplementation((table: string) => {
      if (table === 'rooms') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = roomInsert
        return b
      }
      if (table === 'prices')    return mockQueryBuilder({ data: [] })
      if (table === 'addons') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)

    await user.click(screen.getByRole('button', { name: /new room option/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'Premium Room')
    await user.type(screen.getByLabelText(/display name/i), 'Premium Suite')
    await user.type(screen.getByLabelText(/added price/i), '2000')
    await user.click(screen.getByRole('button', { name: /save room option/i }))

    await waitFor(() => expect(roomInsert).toHaveBeenCalled())
    const payload = (roomInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.admin_title).toBe('Premium Room')
    expect(payload.display_title).toBe('Premium Suite')
    expect(payload.added_price).toBe(2000)

    // The new room is ticked in the list (selecting rooms is now the sole
    // signal — there's no separate "offers rooms" flag).
    await waitFor(() => {
      expect((screen.getByLabelText(/Premium Room/) as HTMLInputElement).checked).toBe(true)
    })
  })

  it('inserts a new add-on from the sub-form and auto-ticks it', async () => {
    const addonInsert = vi.fn().mockReturnValue({
      then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb),
    })
    from.mockImplementation((table: string) => {
      if (table === 'addons') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = addonInsert
        return b
      }
      if (table === 'prices') return mockQueryBuilder({ data: [] })
      if (table === 'rooms')  return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)

    await user.click(screen.getByRole('button', { name: /new add-on/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'SMB')
    await user.type(screen.getByLabelText(/display name/i), 'Surface Marker Buoy')
    await user.type(screen.getByLabelText(new RegExp(`price \\(${siteConfig.locale.currencyLabel}\\)`, 'i')), '100')
    await user.click(screen.getByRole('button', { name: /save add-on/i }))

    await waitFor(() => expect(addonInsert).toHaveBeenCalled())
    const payload = (addonInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.admin_title).toBe('SMB')
    expect(payload.display_title).toBe('Surface Marker Buoy')
    expect(payload.price).toBe(100)

    await waitFor(() =>
      expect((screen.getByLabelText(/^SMB$/) as HTMLInputElement).checked).toBe(true)
    )
  })

  it('inserts a new trip template from the sub-form and selects it as the reference', async () => {
    const travelInsert = vi.fn().mockReturnValue({
      then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb),
    })
    from.mockImplementation((table: string) => {
      if (table === 'trip_templates') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = travelInsert
        return b
      }
      if (table === 'prices')    return mockQueryBuilder({ data: [] })
      if (table === 'rooms')     return mockQueryBuilder({ data: [] })
      if (table === 'addons') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)

    await user.click(screen.getByRole('button', { name: /new trip template/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'Green Island')
    await user.type(screen.getByLabelText(/^Included$/i), 'Tanks, weights, transport')
    await user.click(screen.getByRole('button', { name: /save trip template/i }))

    await waitFor(() => expect(travelInsert).toHaveBeenCalled())
    const payload = (travelInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.admin_title).toBe('Green Island')
    expect(payload.included).toBe('Tanks, weights, transport')

    // Newly created entry becomes the selected option in the trip_templates dropdown.
    await waitFor(() => {
      const select = screen.getByLabelText(/Trip template reference/i) as HTMLSelectElement
      expect(select.value).toBe(payload.id as string)
      expect(select.options[select.selectedIndex].textContent).toMatch(/Green Island/)
    })
  })

  it('sends selected travel_destinations to the create RPC, not onto the event row', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'travel_destinations') return mockQueryBuilder({ data: [
        { id: 'dest-1', admin_title: 'Green Island',  country: 'Taiwan',          sort_order: 1 },
        { id: 'dest-2', admin_title: 'Puerto Galera', country: 'The Philippines', sort_order: 2 },
      ] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)
    await user.type(screen.getByLabelText(/admin title \(required, internal\)/i), 'Multi-destination trip')
    await user.type(getDateInputByLabel(/start date/i),  '2026-06-01')

    await user.click(screen.getByLabelText(/Green Island — Taiwan/))
    await user.click(screen.getByLabelText(/Puerto Galera — The Philippines/))

    await user.click(screen.getByRole('button', { name: /create dive/i }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_events_with_relations', expect.anything()))
    const args = (rpc.mock.calls.find(c => c[0] === 'create_events_with_relations')?.[1] ?? {}) as Record<string, unknown>
    expect(args.p_destination_ids).toEqual(['dest-1', 'dest-2'])
    // destination_reference is not a column — destinations live in the junction.
    const payload = (args.p_events as Record<string, unknown>[])[0]
    expect(payload).not.toHaveProperty('destination_reference')
  })

  it('creates a dive in one transaction and navigates to its detail page', async () => {
    from.mockImplementation(() => mockQueryBuilder({ data: [] }))
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)
    await user.type(screen.getByLabelText(/admin title \(required, internal\)/i), 'Green Island Day Trip')
    await user.type(getDateInputByLabel(/start date/i),  '2026-06-01')
    await user.click(screen.getByRole('button', { name: /create dive/i }))

    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_events_with_relations', expect.anything()))
    const args = (rpc.mock.calls.find(c => c[0] === 'create_events_with_relations')?.[1] ?? {}) as Record<string, unknown>
    const events = args.p_events as Record<string, unknown>[]
    expect(events).toHaveLength(1)
    expect(events[0].admin_title).toBe('Green Island Day Trip')
    expect(events[0].start_date).toBe('2026-06-01')
    // No rule set, so no series is created.
    expect(args.p_series).toBeNull()
    // The id comes back from the RPC — the client no longer mints one.
    expect(events[0].id).toBeUndefined()
    expect(await screen.findByText('EVENT_DETAIL')).toBeInTheDocument()
  })
})

describe('AdminNewEventPage — adding a dive site mid-form', () => {
  it('offers the add-a-place form under the site picker and selects what it creates', async () => {
    // The catalog starts with one site; the admin is writing up a dive to
    // somewhere else, and should not have to leave the half-filled form.
    const sites = [{ id: 's1', name: 'Bat Cave', kind: 'dive', region: 'Longdong', active: true }]
    from.mockImplementation((table: string) => {
      if (table === 'dive_sites') return mockQueryBuilder({ data: sites })
      return mockQueryBuilder({ data: [] })
    })
    createDiveSite.mockResolvedValue('s2')

    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('heading', { name: /new event/i })

    await user.click(screen.getByRole('button', { name: /add new site/i }))
    await user.type(await screen.findByLabelText(/name \(english\)/i), 'Iron House')

    // Adding writes the site, re-reads the catalog and picks the new row.
    sites.push({ id: 's2', name: 'Iron House', kind: 'dive', region: null as unknown as string, active: true })
    await user.click(screen.getByRole('button', { name: /add this place/i }))

    await waitFor(() => expect(createDiveSite).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Iron House', kind: 'dive' }),
    ))
    const select = await screen.findByLabelText(/^site$/i) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('s2'))
    // And the form is back, not left sitting on the add screen.
    expect(screen.queryByRole('button', { name: /add this place/i })).not.toBeInTheDocument()
  })
})
