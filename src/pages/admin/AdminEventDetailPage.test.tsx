import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminEventDetailPage } from './AdminEventDetailPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, useAuthMock, fetchEventsForBookings } = vi.hoisted(() => ({
  from: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsForBookings: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
}))
vi.mock('../../lib/events', async () => {
  const actual = await vi.importActual<typeof import('../../lib/events')>('../../lib/events')
  return {
    ...actual,
    fetchEventsForBookings: (...a: unknown[]) => fetchEventsForBookings(...a),
  }
})
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuthMock() }))

// The AdminNotes + EventStaffSection components do their own supabase reads;
// stub them out since this test is only about the registrant cards.
vi.mock('../../components/admin/AdminNotes', () => ({
  AdminNotes: () => null,
}))
vi.mock('../../components/admin/EventStaffSection', () => ({
  EventStaffSection: () => null,
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/events/:type/:id" element={<AdminEventDetailPage />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  from.mockReset()
  useAuthMock.mockReset()
  fetchEventsForBookings.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'admin-1' }, profile: { id: 'admin-1', role: 'admin' } })
})

describe('AdminEventDetailPage', () => {
  it('renders compact diver cards and expands to show add-ons by display_name', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      eo_dive_id: 'dive_x', eo_course_id: null, notes: null, refund_requested_at: null,
      details: { add_ons: ['addon-a', 'addon-b'], gear: { rent: false } },
    }]
    const profiles = [{
      id: 'u1', full_name: 'Ada Lovelace', display_name: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: true,
      logged_dives: 20, height_cm: 165, weight_kg: 60, shoe_size: 'EU 41 M',
      phone: null, contact_method: null, contact_id: null,
    }]
    const payments: unknown[] = []
    const addons = [
      { _id: 'addon-a', display_name: 'SMB Rental', title: 'SMB' },
      { _id: 'addon-b', display_name: 'Camera Rental (1 Dive)', title: 'Cam' },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'bookings')     return mockQueryBuilder({ data: bookings })
      if (table === 'profiles')     return mockQueryBuilder({ data: profiles })
      if (table === 'payments')     return mockQueryBuilder({ data: payments })
      if (table === 'Other_Addons') return mockQueryBuilder({ data: addons })
      if (table === 'EO_rooms')     return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    // Compact: name + cert/nitrox visible; add-ons (detailed) hidden.
    await screen.findByText('Ada Lovelace')
    expect(screen.getByText(/PADI AOW · Nitrox/)).toBeInTheDocument()
    expect(screen.queryByText(/SMB Rental/)).not.toBeInTheDocument()
    expect(screen.queryByText(/addon-a/)).not.toBeInTheDocument()

    // Expand the card by clicking it.
    await user.click(screen.getByRole('button', { expanded: false, name: /Ada Lovelace/ }))

    // Add-ons now visible, rendered as display_name, not raw _id.
    await waitFor(() => {
      expect(screen.getByText(/SMB Rental/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Camera Rental \(1 Dive\)/)).toBeInTheDocument()
    expect(screen.queryByText(/addon-a/)).not.toBeInTheDocument()

    // Shoe size displayed as JP for admins.
    expect(screen.getByText(/JP 26/)).toBeInTheDocument()
  })

  it('cancels an event via the confirmation modal and updates EO_dives.cancelled_at', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', {
        id: 'dive_x', type: 'dive', title: 'Kenting',
        start_time: new Date().toISOString(), end_time: null, currency: 'TWD',
        cancelled_at: null,
      }],
    ]))

    const updateSpy = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'EO_dives') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.update = updateSpy
        return b
      }
      // No registrants — keep the rest of the page light.
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await screen.findByRole('heading', { name: /kenting/i })
    await user.click(screen.getByRole('button', { name: /cancel event/i }))

    // Modal up; confirm.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /cancel event/i })[1])

    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    const payload = (updateSpy.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(typeof payload.cancelled_at).toBe('string')
    // After confirm the modal closes and the banner appears.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText(/^Cancelled /)).toBeInTheDocument()
  })

  it('restores a cancelled event by clearing cancelled_at', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', {
        id: 'dive_x', type: 'dive', title: 'Kenting',
        start_time: new Date().toISOString(), end_time: null, currency: 'TWD',
        cancelled_at: '2026-04-25T10:00:00.000Z',
      }],
    ]))

    const updateSpy = vi.fn().mockReturnValue({
      eq: () => Promise.resolve({ error: null }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'EO_dives') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.update = updateSpy
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await screen.findByRole('heading', { name: /kenting/i })
    await user.click(screen.getByRole('button', { name: /restore event/i }))
    await user.click(screen.getAllByRole('button', { name: /restore event/i })[1])

    await waitFor(() => expect(updateSpy).toHaveBeenCalled())
    const payload = (updateSpy.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>
    expect(payload.cancelled_at).toBeNull()
  })

  it('hides write controls when the viewer is staff (read-only)', async () => {
    useAuthMock.mockReturnValue({
      user: { id: 'staff-1' },
      profile: { id: 'staff-1', role: 'staff' },
    })
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', {
        id: 'dive_x', type: 'dive', title: 'Kenting',
        start_time: new Date().toISOString(), end_time: null, currency: 'TWD',
        cancelled_at: null,
      }],
    ]))

    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'pending', created_at: '2026-04-20',
      eo_dive_id: 'dive_x', eo_course_id: null, notes: null, refund_requested_at: null,
      details: {},
    }]
    const profiles = [{
      id: 'u1', full_name: 'Ada Lovelace', display_name: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
      logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null,
      phone: null, contact_method: null, contact_id: null,
    }]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })

    renderAt('/admin/events/dive/dive_x')

    // Header still loads, gear-map link still there.
    await screen.findByRole('heading', { name: /kenting/i })
    expect(screen.getByRole('link', { name: /gear map/i })).toBeInTheDocument()

    // Admin-only controls are gone.
    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel event/i })).not.toBeInTheDocument()

    // Per-registrant: status is shown as a label, not a select; Edit registration is gone.
    await screen.findByText('Ada Lovelace')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit registration/i })).not.toBeInTheDocument()
  })
})
