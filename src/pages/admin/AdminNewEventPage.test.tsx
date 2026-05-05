import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AdminNewEventPage } from './AdminNewEventPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
})

function fakeCatalog() {
  // The page fetches three catalog tables on mount before submit is enabled.
  // Hand each lookup a tiny fixture so the FK pickers actually render rows.
  from.mockImplementation((table: string) => {
    if (table === 'EO_prices') return mockQueryBuilder({ data: [{ _id: 'price-1', title: 'Standard',  starting_at: 5000 }] })
    if (table === 'EO_rooms')  return mockQueryBuilder({ data: [{ _id: 'room-1',  display_name: 'Twin', title: 'Twin' }] })
    if (table === 'Other_Addons') return mockQueryBuilder({ data: [{ _id: 'addon-1', display_name: 'Nitrox', title: 'Nitrox' }] })
    return mockQueryBuilder({ data: [] })
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/new']}>
      <Routes>
        <Route path="/admin/new"               element={<AdminNewEventPage />} />
        <Route path="/admin/events/dive/:id"   element={<div>DIVE_DETAIL</div>} />
        <Route path="/admin/events/course/:id" element={<div>COURSE_DETAIL</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminNewEventPage', () => {
  it('defaults to dive type and exposes the dive-only sections', async () => {
    fakeCatalog()
    renderPage()
    expect(await screen.findByRole('heading', { name: /new event/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/dive title/i)).toBeInTheDocument()
    expect(screen.getByText(/dive details/i)).toBeInTheDocument()
    // Course-only sections should be absent
    expect(screen.queryByText(/course details/i)).not.toBeInTheDocument()
  })

  it('switches to course mode when the course pill is clicked', async () => {
    fakeCatalog()
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Course' }))
    expect(screen.getByLabelText(/course title/i)).toBeInTheDocument()
    expect(screen.getByText(/course details/i)).toBeInTheDocument()
    expect(screen.queryByText(/dive details/i)).not.toBeInTheDocument()
  })

  it('blocks submit when dive title is missing', async () => {
    fakeCatalog()
    const user = userEvent.setup()
    renderPage()
    // Browser form validation kicks in before our handler — fill start_date so
    // the dive_title required attribute is the only thing left.
    await screen.findByLabelText(/dive title/i)
    await user.click(screen.getByRole('button', { name: /create dive/i }))
    // We never navigated, so the new-event heading is still visible.
    expect(screen.getByRole('heading', { name: /new event/i })).toBeInTheDocument()
  })

  it('preloads form fields when a past dive is picked', async () => {
    const pastDive = {
      _id: 'past-1',
      dive_title: 'Green Island Day Trip',
      title: 'GI',
      start_date: '2026-01-15',
      time: '09:00:00',
      end_date: '2026-01-15',
      notes: 'Bring fins',
      featured: true,
      fully_booked: false,
      nitrox_required: true,
      has_rooms: false,
      room_types: '',
      other_addons: '',
      price: 'price-1',
    }
    from.mockImplementation((table: string) => {
      if (table === 'EO_prices')    return mockQueryBuilder({ data: [{ _id: 'price-1', title: 'Standard' }] })
      if (table === 'EO_rooms')     return mockQueryBuilder({ data: [] })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: [] })
      if (table === 'EO_dives')     return mockQueryBuilder({ data: [pastDive] })
      if (table === 'EO_courses')   return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByLabelText(/preload from past dive/i) as HTMLSelectElement
    await user.selectOptions(select, 'past-1')
    expect((screen.getByLabelText(/dive title/i) as HTMLInputElement).value).toBe('Green Island Day Trip')
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
      if (table === 'EO_prices') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = priceInsert
        return b
      }
      if (table === 'EO_rooms')     return mockQueryBuilder({ data: [{ _id: 'room-1', display_name: 'Twin', title: 'Twin' }] })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/dive title/i)
    await user.click(screen.getByRole('button', { name: /new price tier/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'Premium')
    await user.type(screen.getByLabelText('Starting at'), '15000')
    await user.click(screen.getByRole('button', { name: /save price tier/i }))
    await waitFor(() => expect(priceInsert).toHaveBeenCalled())
    const payload = (priceInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.title).toBe('Premium')
    expect(payload.starting_at).toBe(15000)
    // Newly created tier becomes the selected option in the price dropdown.
    await waitFor(() => {
      const select = screen.getByLabelText(/price tier/i) as HTMLSelectElement
      expect(select.value).toBe(payload._id as string)
      expect(select.options[select.selectedIndex].textContent).toMatch(/Premium/)
    })
  })

  it('inserts a new room option from the sub-form, auto-ticks it, and enables has_rooms', async () => {
    const roomInsert = vi.fn().mockReturnValue({
      then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb),
    })
    from.mockImplementation((table: string) => {
      if (table === 'EO_rooms') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = roomInsert
        return b
      }
      if (table === 'EO_prices')    return mockQueryBuilder({ data: [] })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/dive title/i)
    // has_rooms starts false; the sub-form should flip it on save.
    expect((screen.getByLabelText(/^offers rooms$/i) as HTMLInputElement).checked).toBe(false)

    await user.click(screen.getByRole('button', { name: /new room option/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'Premium Room')
    await user.type(screen.getByLabelText(/display name/i), 'Premium Suite')
    await user.type(screen.getByLabelText(/added price/i), '2000')
    await user.click(screen.getByRole('button', { name: /save room option/i }))

    await waitFor(() => expect(roomInsert).toHaveBeenCalled())
    const payload = (roomInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.title).toBe('Premium Room')
    expect(payload.display_name).toBe('Premium Suite')
    expect(payload.added_price).toBe(2000)

    // has_rooms toggle flipped on, and the new room is checked in the list.
    await waitFor(() => {
      expect((screen.getByLabelText(/^offers rooms$/i) as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText(/Premium Suite/) as HTMLInputElement).checked).toBe(true)
    })
  })

  it('inserts a new add-on from the sub-form and auto-ticks it', async () => {
    const addonInsert = vi.fn().mockReturnValue({
      then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb),
    })
    from.mockImplementation((table: string) => {
      if (table === 'Other_Addons') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = addonInsert
        return b
      }
      if (table === 'EO_prices') return mockQueryBuilder({ data: [] })
      if (table === 'EO_rooms')  return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/dive title/i)

    await user.click(screen.getByRole('button', { name: /new add-on/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'SMB')
    await user.type(screen.getByLabelText(/display name/i), 'Surface Marker Buoy')
    await user.type(screen.getByLabelText(/price \(NTD\)/i), '100')
    await user.click(screen.getByRole('button', { name: /save add-on/i }))

    await waitFor(() => expect(addonInsert).toHaveBeenCalled())
    const payload = (addonInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.title).toBe('SMB')
    expect(payload.display_name).toBe('Surface Marker Buoy')
    expect(payload.price).toBe(100)

    await waitFor(() =>
      expect((screen.getByLabelText(/Surface Marker Buoy/) as HTMLInputElement).checked).toBe(true)
    )
  })

  it('inserts a new DiveTravel entry from the sub-form and selects it as the reference', async () => {
    const travelInsert = vi.fn().mockReturnValue({
      then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb),
    })
    from.mockImplementation((table: string) => {
      if (table === 'DiveTravel') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = travelInsert
        return b
      }
      if (table === 'EO_prices')    return mockQueryBuilder({ data: [] })
      if (table === 'EO_rooms')     return mockQueryBuilder({ data: [] })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/dive title/i)

    await user.click(screen.getByRole('button', { name: /new DiveTravel entry/i }))
    await user.type(screen.getByLabelText('Title (required)'), 'Green Island')
    await user.type(screen.getByLabelText(/^Included$/i), 'Tanks, weights, transport')
    await user.click(screen.getByRole('button', { name: /save DiveTravel entry/i }))

    await waitFor(() => expect(travelInsert).toHaveBeenCalled())
    const payload = (travelInsert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.title).toBe('Green Island')
    expect(payload.included).toBe('Tanks, weights, transport')

    // Newly created entry becomes the selected option in the DiveTravel dropdown.
    await waitFor(() => {
      const select = screen.getByLabelText(/DiveTravel reference/i) as HTMLSelectElement
      expect(select.value).toBe(payload._id as string)
      expect(select.options[select.selectedIndex].textContent).toMatch(/Green Island/)
    })
  })

  it('encodes selected TravelDestinations into destination_reference as a JSON array', async () => {
    const insert = vi.fn().mockReturnValue({ then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb) })
    from.mockImplementation((table: string) => {
      if (table === 'TravelDestinations') return mockQueryBuilder({ data: [
        { _id: 'dest-1', title: 'Green Island',  country: 'Taiwan',          sort_order: 1 },
        { _id: 'dest-2', title: 'Puerto Galera', country: 'The Philippines', sort_order: 2 },
      ] })
      if (table === 'EO_dives') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = insert
        return b
      }
      return mockQueryBuilder({ data: [] })
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByLabelText(/dive title/i)
    await user.type(screen.getByLabelText(/dive title/i), 'Multi-destination trip')
    await user.type(screen.getByLabelText(/start date/i),  '2026-06-01')

    await user.click(screen.getByLabelText(/Green Island — Taiwan/))
    await user.click(screen.getByLabelText(/Puerto Galera — The Philippines/))

    await user.click(screen.getByRole('button', { name: /create dive/i }))

    await waitFor(() => expect(insert).toHaveBeenCalled())
    const payload = (insert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.destination_reference).toBe(JSON.stringify(['dest-1', 'dest-2']))
  })

  it('inserts a dive with minimum required fields and navigates to its detail page', async () => {
    const insert = vi.fn().mockReturnValue({ then: (cb: (r: { error: null }) => void) => Promise.resolve({ error: null }).then(cb) })
    from.mockImplementation((table: string) => {
      if (table === 'EO_prices')    return mockQueryBuilder({ data: [] })
      if (table === 'EO_rooms')     return mockQueryBuilder({ data: [] })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: [] })
      if (table === 'EO_dives') {
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
    await screen.findByLabelText(/dive title/i)
    await user.type(screen.getByLabelText(/dive title/i), 'Green Island Day Trip')
    await user.type(screen.getByLabelText(/start date/i),  '2026-06-01')
    await user.click(screen.getByRole('button', { name: /create dive/i }))
    await waitFor(() => expect(insert).toHaveBeenCalled())
    const payload = (insert.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.dive_title).toBe('Green Island Day Trip')
    expect(payload.start_date).toBe('2026-06-01')
    expect(typeof payload._id).toBe('string')
    expect(await screen.findByText('DIVE_DETAIL')).toBeInTheDocument()
  })
})
