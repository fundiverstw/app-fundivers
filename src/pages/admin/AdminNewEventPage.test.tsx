import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { siteConfig } from '../../config/site'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminNewEventPage } from './AdminNewEventPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a), rpc: (...a: unknown[]) => rpc(...a) },
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', role: 'admin' } }),
}))

beforeEach(() => {
  from.mockReset()
  rpc.mockReset()
  // set_event_relations writes the junctions after the row insert.
  rpc.mockResolvedValue({ error: null })
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
      if (table === 'events')       return mockQueryBuilder({ data: [pastDive] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByLabelText(/preload from past dive/i) as HTMLSelectElement
    await user.selectOptions(select, 'past-1')
    expect((screen.getByLabelText(/admin title \(required, internal\)/i) as HTMLInputElement).value).toBe('Green Island Day Trip')
    expect((screen.getByLabelText(/start date/i) as HTMLInputElement).value).toBe('2026-01-15')
    expect((screen.getByLabelText(/start time/i) as HTMLInputElement).value).toBe('09:00')
    expect((screen.getByLabelText(/notes/i) as HTMLTextAreaElement).value).toBe('Bring fins')
    expect((screen.getByLabelText(/^featured$/i) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/nitrox required/i) as HTMLInputElement).checked).toBe(true)
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

  it('writes selected travel_destinations to the junctions via set_event_relations', async () => {
    const insert = vi.fn().mockReturnValue({ then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb) })
    from.mockImplementation((table: string) => {
      if (table === 'travel_destinations') return mockQueryBuilder({ data: [
        { id: 'dest-1', admin_title: 'Green Island',  country: 'Taiwan',          sort_order: 1 },
        { id: 'dest-2', admin_title: 'Puerto Galera', country: 'The Philippines', sort_order: 2 },
      ] })
      if (table === 'events') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = insert
        return b
      }
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)
    await user.type(screen.getByLabelText(/admin title \(required, internal\)/i), 'Multi-destination trip')
    await user.type(screen.getByLabelText(/start date/i),  '2026-06-01')

    await user.click(screen.getByLabelText(/Green Island — Taiwan/))
    await user.click(screen.getByLabelText(/Puerto Galera — The Philippines/))

    await user.click(screen.getByRole('button', { name: /create dive/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    // destination_reference is no longer on the row — it goes to the junction
    // tables through the RPC (keyed by event id, no per-kind arg).
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_event_relations', expect.anything()))
    const relArgs = (rpc.mock.calls.find(c => c[0] === 'set_event_relations')?.[1] ?? {}) as Record<string, unknown>
    expect(relArgs.p_destination_ids).toEqual(['dest-1', 'dest-2'])
    const payload = (insert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload).not.toHaveProperty('destination_reference')
  })

  it('inserts a dive with minimum required fields and navigates to its detail page', async () => {
    const insert = vi.fn().mockReturnValue({ then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb) })
    from.mockImplementation((table: string) => {
      if (table === 'prices')    return mockQueryBuilder({ data: [] })
      if (table === 'rooms')     return mockQueryBuilder({ data: [] })
      if (table === 'addons') return mockQueryBuilder({ data: [] })
      if (table === 'events') {
        // Hybrid: select() chain (past-event fetch) returns empty,
        // insert() routes through the spy so we can assert payload.
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = insert
        return b
      }
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/admin title \(required, internal\)/i)
    await user.type(screen.getByLabelText(/admin title \(required, internal\)/i), 'Green Island Day Trip')
    await user.type(screen.getByLabelText(/start date/i),  '2026-06-01')
    await user.click(screen.getByRole('button', { name: /create dive/i }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    const payload = (insert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.admin_title).toBe('Green Island Day Trip')
    expect(payload.start_date).toBe('2026-06-01')
    expect(typeof payload.id).toBe('string')
    expect(await screen.findByText('EVENT_DETAIL')).toBeInTheDocument()
  })
})
