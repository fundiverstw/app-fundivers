import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminEditEventPage } from './AdminEditEventPage'
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
  // set_event_relations reconciles the junctions after the row update.
  rpc.mockResolvedValue({ error: null })
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/events/:id/edit" element={<AdminEditEventPage />} />
        <Route path="/admin/events/:id"      element={<div>EVENT_DETAIL</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('AdminEditEventPage', () => {
  it('prefills the form from the events row and submits an update on save', async () => {
    const existing = {
      id: 'dive_x', kind: 'dive',
      admin_title: 'Kenting Day Trip',
      display_title: 'Subtitle',
      start_date: '2026-06-01',
      start_time: '08:00:00',
      end_date: '2026-06-01',
      featured: false,
      fully_booked: false,
      price: null,
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
      trip_template_id: null,
      prereq_cert_id: null,
      cancelled_at: null,
    }

    const updateSpy = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'events') {
        // The page calls .select('*').eq('id', id).maybeSingle()
        // and then .update(payload).eq('id', id) on submit.
        // Hand both code paths the right surface from one builder.
        const b = mockQueryBuilder({ data: existing }) as Record<string, unknown>
        b.update = updateSpy
        return b
      }
      // Catalog reads (prices/rooms/addons/cert_levels) + junction reads
      // (event_rooms/event_addons/event_destinations) just return empty.
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive_x/edit')

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
    // Update payload should not carry id (that's in the .eq filter).
    expect(payload.id).toBeUndefined()
    // Navigated to the detail page after save.
    expect(await screen.findByText('EVENT_DETAIL')).toBeInTheDocument()
  })

  it('shows the car-assignment and waiver sections on a dive edit', async () => {
    const existing = {
      id: 'dive_x', kind: 'dive', admin_title: 'Kenting Day Trip', display_title: 'Subtitle',
      start_date: '2026-06-01', start_time: '08:00:00', end_date: '2026-06-01',
      featured: false, fully_booked: false, price: null,
      gear_rental: null, nitrox_required: false, dive_days: 1,
      featured_image: null, second_image: null, prereqs: null, req_dives: null,
      notes: '', cancel_date: null, cancel_policy: null,
      trip_template_id: null,
      prereq_cert_id: null, cancelled_at: null,
    }
    from.mockImplementation((table: string) => {
      if (table === 'events') return mockQueryBuilder({ data: existing })
      return mockQueryBuilder({ data: [] })
    })

    renderAt('/admin/events/dive_x/edit')
    await screen.findByLabelText(/admin title \(required, internal\)/i)

    // The edit form carries a "Cars for this event" section.
    expect(screen.getByText(/cars for this event/i)).toBeInTheDocument()
    // ...and a per-event "Waiver requirements" section.
    expect(await screen.findByText(/waiver requirements/i)).toBeInTheDocument()
  })

  it('prefills the Wix featured/second image fields and round-trips them into the update payload', async () => {
    // Both inputs round-trip the wix:image:// URI verbatim — no parsing,
    // no validation beyond a soft hint we don't assert on here.
    const existing = {
      id: 'dive_x', kind: 'dive',
      admin_title: 'Kenting Day Trip',
      display_title: 'Subtitle',
      start_date: '2026-06-01',
      start_time: '08:00:00',
      end_date: '2026-06-01',
      featured: false,
      fully_booked: false,
      price: null,
      gear_rental: null,
      nitrox_required: false,
      dive_days: 1,
      featured_image: 'wix:image://v1/abc/featured.jpg#originWidth=2000&originHeight=3000',
      second_image:   'wix:image://v1/def/second.jpg#originWidth=2000&originHeight=3000',
      prereqs: null, req_dives: null,
      notes: '',
      cancel_date: null, cancel_policy: null,
      trip_template_id: null,
      prereq_cert_id: null, cancelled_at: null,
    }
    const updateSpy = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
    from.mockImplementation((table: string) => {
      if (table === 'events') {
        const b = mockQueryBuilder({ data: existing }) as Record<string, unknown>
        b.update = updateSpy
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive_x/edit')

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
      if (table === 'events') return mockQueryBuilder({ data: null })
      return mockQueryBuilder({ data: [] })
    })

    renderAt('/admin/events/missing/edit')
    expect(await screen.findByText(/event not found/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/admin title \(required, internal\)/i)).not.toBeInTheDocument()
  })
})
