import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminEditEventPage } from './AdminEditEventPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))

beforeEach(() => {
  from.mockReset()
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
