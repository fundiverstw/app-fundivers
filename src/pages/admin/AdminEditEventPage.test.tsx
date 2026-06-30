import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminEditEventPage } from './AdminEditEventPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, moveSpy } = vi.hoisted(() => ({ from: vi.fn(), moveSpy: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { id: 'admin-1', role: 'admin' } }),
}))
vi.mock('../../lib/event-vehicles', async () => {
  const actual = await vi.importActual<typeof import('../../lib/event-vehicles')>('../../lib/event-vehicles')
  return { ...actual, moveDiveCarAllocations: (...a: unknown[]) => moveSpy(...a) }
})

beforeEach(() => {
  from.mockReset()
  moveSpy.mockReset()
  moveSpy.mockResolvedValue({ moved: 0, dropped: 0 })
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/events/:type/:id/edit" element={<AdminEditEventPage />} />
        <Route path="/admin/events/:type/:id"      element={<div>EVENT_DETAIL</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminEditEventPage', () => {
  it('prefills the form from EO_dives and submits an update on save', async () => {
    const existing = {
      _id: 'dive_x',
      admin_title: 'Kenting Day Trip',
      display_title: 'Subtitle',
      start_date: '2026-06-01',
      time: '08:00:00',
      end_date: '2026-06-01',
      featured: false,
      fully_booked: false,
      price: null,
      has_rooms: false,
      room_types: '',
      hasotheraddons: false,
      other_addons: '',
      gear_rental: null,
      nitrox_required: false,
      dive_days: 1,
      featured_image: null,
      second_image: null,
      prereqs: null,
      req_dives: null,
      notes: 'Bring fins',
      cancel_date: null,
      cancel_policy: null,
      destination_reference: null,
      DiveTravel_reference: null,
      prereq_cert_id: null,
      cancelled_at: null,
    }

    const updateSpy = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'EO_dives') {
        // The page calls .select('*').eq('_id', id).maybeSingle()
        // and then .update(payload).eq('_id', id) on submit.
        // Hand both code paths the right surface from one builder.
        const b = mockQueryBuilder({ data: existing }) as Record<string, unknown>
        b.update = updateSpy
        return b
      }
      // Catalog reads (prices/rooms/addons/cert_levels) just return empty.
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x/edit')

    // Form prefills the existing dive title.
    const titleInput = await screen.findByLabelText(/admin title \(required, internal\)/i) as HTMLInputElement
    await waitFor(() => expect(titleInput.value).toBe('Kenting Day Trip'))
    expect((screen.getByLabelText(/start date/i) as HTMLInputElement).value).toBe('2026-06-01')
    expect((screen.getByLabelText(/notes/i) as HTMLTextAreaElement).value).toBe('Bring fins')

    // Type a new title and save.
    await user.clear(titleInput)
    await user.type(titleInput, 'Kenting Day Trip (revised)')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    const payload = (updateSpy.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.admin_title).toBe('Kenting Day Trip (revised)')
    // Update payload should not carry _id (that's in the .eq filter).
    expect(payload._id).toBeUndefined()
    // Navigated to the detail page after save.
    expect(await screen.findByText('EVENT_DETAIL')).toBeInTheDocument()
  })

  it('shows the car-assignment section and moves allocations when the start date changes on save', async () => {
    const existing = {
      _id: 'dive_x', admin_title: 'Kenting Day Trip', display_title: 'Subtitle',
      start_date: '2026-06-01', time: '08:00:00', end_date: '2026-06-01',
      featured: false, fully_booked: false, price: null,
      has_rooms: false, room_types: '', hasotheraddons: false, other_addons: '',
      gear_rental: null, nitrox_required: false, dive_days: 1,
      featured_image: null, second_image: null, prereqs: null, req_dives: null,
      notes: '', cancel_date: null, cancel_policy: null,
      destination_reference: null, DiveTravel_reference: null,
      prereq_cert_id: null, cancelled_at: null,
    }
    const updateSpy = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    from.mockImplementation((table: string) => {
      if (table === 'EO_dives') {
        const b = mockQueryBuilder({ data: existing }) as Record<string, unknown>
        b.update = updateSpy
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x/edit')
    await screen.findByLabelText(/admin title \(required, internal\)/i)

    // The edit form now carries a "Cars for this dive" section.
    expect(screen.getByText(/cars for this dive/i)).toBeInTheDocument()
    // ...and a per-event "Waiver requirements" section.
    expect(await screen.findByText(/waiver requirements/i)).toBeInTheDocument()

    // Move the dive a week later, then save.
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-06-08' } })
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(moveSpy).toHaveBeenCalledWith('dive_x', '2026-06-01', '2026-06-08'))
  })

  it('prefills the Wix featured/second image fields and round-trips them into the update payload', async () => {
    // Both inputs round-trip the wix:image:// URI verbatim — no parsing,
    // no validation beyond a soft hint we don't assert on here.
    const existing = {
      _id: 'dive_x',
      admin_title: 'Kenting Day Trip',
      display_title: 'Subtitle',
      start_date: '2026-06-01',
      time: '08:00:00',
      end_date: '2026-06-01',
      featured: false,
      fully_booked: false,
      price: null,
      has_rooms: false, room_types: '',
      hasotheraddons: false, other_addons: '',
      gear_rental: null,
      nitrox_required: false,
      dive_days: 1,
      featured_image: 'wix:image://v1/abc/featured.jpg#originWidth=2000&originHeight=3000',
      second_image:   'wix:image://v1/def/second.jpg#originWidth=2000&originHeight=3000',
      prereqs: null, req_dives: null,
      notes: '',
      cancel_date: null, cancel_policy: null,
      destination_reference: null, DiveTravel_reference: null,
      prereq_cert_id: null, cancelled_at: null,
    }
    const updateSpy = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    from.mockImplementation((table: string) => {
      if (table === 'EO_dives') {
        const b = mockQueryBuilder({ data: existing }) as Record<string, unknown>
        b.update = updateSpy
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x/edit')

    const featuredInput = await screen.findByLabelText(/featured image \(wix uri\)/i) as HTMLInputElement
    const secondInput = screen.getByLabelText(/second image \(wix uri\)/i) as HTMLInputElement
    await waitFor(() => {
      expect(featuredInput.value).toBe(existing.featured_image)
      expect(secondInput.value).toBe(existing.second_image)
    })

    // Swap both for new URIs and save.
    await user.clear(featuredInput)
    await user.type(featuredInput, 'wix:image://v1/new/hero.jpg')
    await user.clear(secondInput)
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    const payload = (updateSpy.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.featured_image).toBe('wix:image://v1/new/hero.jpg')
    // Empty input round-trips to null in the payload.
    expect(payload.second_image).toBeNull()
  })

  it('renders an error and no form when the dive is not found', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'EO_dives') return mockQueryBuilder({ data: null })
      return mockQueryBuilder({ data: [] })
    })

    renderAt('/admin/events/dive/missing/edit')
    expect(await screen.findByText(/dive not found/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/admin title \(required, internal\)/i)).not.toBeInTheDocument()
  })
})
