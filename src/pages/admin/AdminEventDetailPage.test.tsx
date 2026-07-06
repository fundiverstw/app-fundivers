import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminEventDetailPage } from './AdminEventDetailPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, rpc, invoke, useAuthMock, fetchEventsForBookings } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsForBookings: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: toastError, info: vi.fn() }),
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
  rpc.mockReset()
  invoke.mockReset()
  useAuthMock.mockReset()
  fetchEventsForBookings.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
  useAuthMock.mockReturnValue({ user: { id: 'admin-1' }, profile: { id: 'admin-1', role: 'admin' } })
})

describe('AdminEventDetailPage', () => {
  it('renders compact diver cards and expands to show add-ons by display_title', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: { add_ons: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'], gear: { rent: false } },
    }]
    const profiles = [{
      id: 'u1', name: 'Ada Lovelace', nickname: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: true,
      logged_dives: 20, height_cm: 165, weight_kg: 60, shoe_size: 'EU 41 M',
      contact_method: null, contact_id: null,
    }]
    const payments: unknown[] = []
    const addons = [
      { id: '11111111-1111-4111-8111-111111111111', display_title: 'SMB Rental', admin_title: 'SMB' },
      { id: '22222222-2222-4222-8222-222222222222', display_title: 'Camera Rental (1 Dive)', admin_title: 'Cam' },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'bookings')     return mockQueryBuilder({ data: bookings })
      if (table === 'profiles')     return mockQueryBuilder({ data: profiles })
      if (table === 'payments')     return mockQueryBuilder({ data: payments })
      if (table === 'addons') return mockQueryBuilder({ data: addons })
      if (table === 'rooms')     return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    // Dense row: only name is visible when collapsed. Cert + add-ons hidden.
    await screen.findByText('Ada Lovelace')
    expect(screen.queryByText(/PADI AOW · Nitrox/)).not.toBeInTheDocument()
    expect(screen.queryByText(/SMB Rental/)).not.toBeInTheDocument()
    expect(screen.queryByText(/11111111-1111/)).not.toBeInTheDocument()

    // Expand the card by clicking it.
    await user.click(screen.getByRole('button', { expanded: false, name: /Ada Lovelace/ }))

    // Cert info + add-ons (display_title, not raw _id) now visible.
    await waitFor(() => {
      expect(screen.getByText(/PADI AOW · Nitrox/)).toBeInTheDocument()
      expect(screen.getByText(/SMB Rental/)).toBeInTheDocument()
    })
    expect(screen.getByText(/Camera Rental \(1 Dive\)/)).toBeInTheDocument()
    expect(screen.queryByText(/11111111-1111/)).not.toBeInTheDocument()

    // Shoe size displayed as JP for admins.
    expect(screen.getByText(/JP 26/)).toBeInTheDocument()
  })

  it('flags a registrant who is missing required waivers, and clears the flag once signed', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))
    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: { gear: { rent: false } },
    }]
    const profiles = [{ id: 'u1', name: 'Ada Lovelace', nickname: 'Ada', contact_method: null, contact_id: null }]

    // No signatures on file → both annual dive waivers are missing.
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })
    const { unmount } = renderAt('/admin/events/dive/dive_x')
    await screen.findByText('Ada Lovelace')
    expect(await screen.findByText(/Missing:.*Boat Travel/i)).toBeInTheDocument()
    unmount()

    // Both annual waivers signed + current → the flag becomes "Waivers OK".
    const sigs = [
      { id: 's1', diver_id: 'u1', waiver_code: 'padi_liability', waiver_version: 1, signed_at: new Date().toISOString(), signed_name: 'Ada', event_id: null, created_at: '' },
      { id: 's2', diver_id: 'u1', waiver_code: 'diver_medical',  waiver_version: 1, signed_at: new Date().toISOString(), signed_name: 'Ada', event_id: null, created_at: '' },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'waiver_signatures') return mockQueryBuilder({ data: sigs })
      return mockQueryBuilder({ data: [] })
    })
    renderAt('/admin/events/dive/dive_x')
    await screen.findByText('Ada Lovelace')
    expect(await screen.findByText(/Waivers OK/i)).toBeInTheDocument()
  })

  it('shows an unknown ("Waivers —") badge rather than a false OK when the waiver lookup fails', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))
    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: { gear: { rent: false } },
    }]
    const profiles = [{ id: 'u1', name: 'Ada Lovelace', nickname: 'Ada', contact_method: null, contact_id: null }]

    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      // The signature read errors → the roster must not claim everyone is covered.
      if (table === 'waiver_signatures') return mockQueryBuilder({ error: { message: 'boom' } })
      return mockQueryBuilder({ data: [] })
    })
    renderAt('/admin/events/dive/dive_x')
    await screen.findByText('Ada Lovelace')
    expect(await screen.findByText(/Waivers —/i)).toBeInTheDocument()
    expect(screen.queryByText(/Waivers OK/i)).not.toBeInTheDocument()
  })

  it('resolves valid add-on names even when a booking carries a malformed add-on id', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: { add_ons: ['11111111-1111-4111-8111-111111111111', 'legacy-bubble-id'], gear: { rent: false } },
    }]
    const profiles = [{
      id: 'u1', name: 'Ada Lovelace', nickname: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: true,
      logged_dives: 20, height_cm: 165, weight_kg: 60, shoe_size: 'EU 41 M',
      contact_method: null, contact_id: null,
    }]
    const addons = [
      { id: '11111111-1111-4111-8111-111111111111', display_title: 'SMB Rental', admin_title: 'SMB' },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'bookings')     return mockQueryBuilder({ data: bookings })
      if (table === 'profiles')     return mockQueryBuilder({ data: profiles })
      if (table === 'payments')     return mockQueryBuilder({ data: [] })
      if (table === 'addons') return mockQueryBuilder({ data: addons })
      if (table === 'rooms')     return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')
    await user.click(await screen.findByRole('button', { expanded: false, name: /Ada Lovelace/ }))

    await waitFor(() => expect(screen.getByText(/SMB Rental/)).toBeInTheDocument())
    expect(screen.queryByText(/11111111-1111/)).not.toBeInTheDocument()
  })

  it('cancels an event via the confirmation modal and updates events.cancelled_at', async () => {
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
      if (table === 'events') {
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
      if (table === 'events') {
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

  it('hides the Delete button until the event has been cancelled', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', {
        id: 'dive_x', type: 'dive', title: 'Kenting',
        start_time: new Date().toISOString(), end_time: null, currency: 'TWD',
        cancelled_at: null,
      }],
    ]))
    from.mockImplementation(() => mockQueryBuilder({ data: [] }))

    renderAt('/admin/events/dive/dive_x')
    await screen.findByRole('heading', { name: /kenting/i })
    expect(screen.queryByRole('button', { name: /^delete event$/i })).not.toBeInTheDocument()
  })

  it('cascade-deletes a cancelled event after the admin types the title to confirm, then navigates back to /admin/events', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', {
        id: 'dive_x', type: 'dive', title: 'Kenting',
        start_time: new Date().toISOString(), end_time: null, currency: 'TWD',
        cancelled_at: '2026-04-25T10:00:00.000Z',
      }],
    ]))

    const deleteSpy = vi.fn().mockReturnValue({
      eq: (col: string, val: string) => Promise.resolve({ error: null, data: { col, val } }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'events') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.delete = deleteSpy
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/admin/events/dive/dive_x']}>
        <Routes>
          <Route path="/admin/events/:type/:id" element={<AdminEventDetailPage />} />
          <Route path="/admin/events" element={<div>events-index</div>} />
        </Routes>
      </MemoryRouter>
    )

    await screen.findByRole('heading', { name: /kenting/i })
    await user.click(screen.getByRole('button', { name: /^delete event$/i }))

    // Modal up; the confirm button is disabled until the title is typed.
    const dialog = await screen.findByRole('dialog', { name: /delete event permanently/i })
    const confirmBtn = within(dialog).getByRole('button', { name: /delete forever/i })
    expect(confirmBtn).toBeDisabled()

    await user.type(within(dialog).getByRole('textbox'), 'Kenting')
    expect(confirmBtn).toBeEnabled()
    await user.click(confirmBtn)

    await waitFor(() => expect(deleteSpy).toHaveBeenCalled())
    // After delete the user lands on the events index route.
    expect(await screen.findByText('events-index')).toBeInTheDocument()
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
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: {},
    }]
    const profiles = [{
      id: 'u1', name: 'Ada Lovelace', nickname: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
      logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null,
      contact_method: null, contact_id: null,
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
    expect(screen.queryByRole('button', { name: /add diver/i })).not.toBeInTheDocument()

    // Per-registrant: status is shown as a label, not a select; Edit registration is gone.
    await screen.findByText('Ada Lovelace')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit registration/i })).not.toBeInTheDocument()
  })

  it('opens the Add diver modal, searches profiles, and advances to the registration form on pick', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', {
        id: 'dive_x', type: 'dive', title: 'Kenting',
        start_time: new Date().toISOString(), end_time: null, currency: 'TWD',
        cancelled_at: null,
        // RegisterFormBody reads these to gate room/addon/gear sections.
        has_rooms: false, room_type_ids: [], has_addons: false, addon_ids: [],
        nitrox_required: false, gear_rental_info: null,
        price: 2800, deposit_amount: 0, transport_price: 0, dive_days: 1,
      }],
    ]))

    const profiles = [
      { id: 'u-ada',  name: 'Ada Lovelace',     nickname: 'Ada',
        cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
        logged_dives: 0, contact_method: null, contact_id: null,
        height_cm: null, weight_kg: null, shoe_size: null, status: 'active' },
      { id: 'u-bob',  name: 'Bob Roberts',      nickname: null,
        cert_agency: 'PADI', cert_level: 'OW', nitrox_certified: false,
        logged_dives: 0, contact_method: null, contact_id: null,
        height_cm: null, weight_kg: null, shoe_size: null, status: 'active' },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      // No registrants on this event yet; everything else stays empty.
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await screen.findByRole('heading', { name: /kenting/i })
    await user.click(screen.getByRole('button', { name: /add diver/i }))

    // Step A: search box + both divers visible.
    const dialog = await screen.findByRole('dialog', { name: /add diver to event/i })
    expect(within(dialog).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(dialog).getByText('Bob Roberts')).toBeInTheDocument()

    // Filter narrows to Ada.
    await user.type(within(dialog).getByPlaceholderText(/search by name/i), 'Ada')
    expect(within(dialog).getByText('Ada Lovelace')).toBeInTheDocument()
    expect(within(dialog).queryByText('Bob Roberts')).not.toBeInTheDocument()

    // Pick Ada → step B reuses RegisterFormBody (Step 1 of 4 visible).
    await user.click(within(dialog).getByRole('button', { name: /Ada Lovelace/ }))
    await screen.findByText(/Step 1 of 4/i)
    expect(screen.getByRole('heading', { name: /Register Ada/i })).toBeInTheDocument()
  })

  it('"Mark deposit paid" confirms a pending booking without recording a payment or touching the balance', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'pending', created_at: '2026-04-20',
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: { total: 4900, deposit: 4900, payment_method: 'cash' },
    }]
    const profiles = [{
      id: 'u1', name: 'Ada Lovelace', nickname: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
      logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null,
      contact_method: null, contact_id: null,
    }]

    const paymentInsert = vi.fn().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({
          data: {
            id: 'pay-1', created_at: '2026-05-14T10:00:00Z', amount: 4900,
            status: 'paid', method: 'cash', note: 'Deposit',
            user_id: 'u1', booking_id: 'b1', currency: 'TWD', recorded_by: 'admin-1',
          },
          error: null,
        }),
      }),
    })
    const bookingUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })

    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        const b = mockQueryBuilder({ data: bookings }) as Record<string, unknown>
        b.update = bookingUpdate
        return b
      }
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'payments') {
        const b = mockQueryBuilder({ data: [] }) as Record<string, unknown>
        b.insert = paymentInsert
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await user.click(await screen.findByRole('button', { expanded: false, name: /Ada Lovelace/ }))
    // The button label no longer carries the deposit amount — it's a pure
    // status action now.
    await user.click(await screen.findByRole('button', { name: /^mark deposit paid$/i }))

    // Status promotes to confirmed …
    await waitFor(() => expect(bookingUpdate).toHaveBeenCalledWith({ status: 'confirmed' }))
    // … but NO payment is recorded and the balance is untouched.
    expect(paymentInsert).not.toHaveBeenCalled()
  })

  it('records a custom partial balance payment without promoting status', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    // confirmed booking with deposit already paid; admin records partial balance.
    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: { total: 12000, deposit: 2000, payment_method: 'bank_transfer' },
    }]
    const profiles = [{
      id: 'u1', name: 'Ada Lovelace', nickname: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
      logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null,
      contact_method: null, contact_id: null,
    }]
    const existingPayments = [{
      id: 'pay-0', created_at: '2026-05-01T10:00:00Z', amount: 2000,
      status: 'paid', method: 'bank_transfer', note: 'Deposit',
      user_id: 'u1', booking_id: 'b1', currency: 'TWD', recorded_by: 'admin-1',
    }]

    const paymentInsert = vi.fn().mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({
          data: {
            id: 'pay-1', created_at: '2026-05-14T10:00:00Z', amount: 3000,
            status: 'paid', method: 'bank_transfer', note: 'Partial #1',
            user_id: 'u1', booking_id: 'b1', currency: 'TWD', recorded_by: 'admin-1',
          },
          error: null,
        }),
      }),
    })
    const bookingUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) })

    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        const b = mockQueryBuilder({ data: bookings }) as Record<string, unknown>
        b.update = bookingUpdate
        return b
      }
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'payments') {
        const b = mockQueryBuilder({ data: existingPayments }) as Record<string, unknown>
        b.insert = paymentInsert
        return b
      }
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await user.click(await screen.findByRole('button', { expanded: false, name: /Ada Lovelace/ }))

    // Deposit is fully paid → "Mark deposit paid" should be hidden.
    expect(screen.queryByRole('button', { name: /mark deposit paid/i })).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/paid amount/i), '3000')
    await user.type(screen.getByPlaceholderText(/note \(optional/i), 'Partial #1')
    await user.click(screen.getByRole('button', { name: /^record payment$/i }))

    await waitFor(() => expect(paymentInsert).toHaveBeenCalled())
    const insertedPayment = paymentInsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertedPayment).toMatchObject({
      user_id: 'u1', booking_id: 'b1', amount: 3000, status: 'paid', note: 'Partial #1',
    })

    // Booking is already confirmed; no status update should fire.
    expect(bookingUpdate).not.toHaveBeenCalled()
  })

  it('creates a new diver account from the Add diver modal and advances to the register step', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', {
        id: 'dive_x', type: 'dive', title: 'Kenting',
        start_time: new Date().toISOString(), end_time: null, currency: 'TWD',
        cancelled_at: null,
        has_rooms: false, room_type_ids: [], has_addons: false, addon_ids: [],
        nitrox_required: false, gear_rental_info: null,
        price: 2800, deposit_amount: 0, transport_price: 0, dive_days: 1,
      }],
    ]))

    const newProfile = {
      id: 'u-new', name: 'Eve Tester', nickname: 'Eve',
      cert_agency: null, cert_level: null, nitrox_certified: false,
      logged_dives: 0, contact_method: null, contact_id: null,
      height_cm: null, weight_kg: null, shoe_size: null, status: 'active',
    }

    // First profiles call (modal list) returns no existing divers. Second
    // profiles call (after create) returns the new profile by id.
    let profilesCallCount = 0
    from.mockImplementation((table: string) => {
      if (table === 'profiles') {
        profilesCallCount += 1
        if (profilesCallCount === 1) return mockQueryBuilder({ data: [] })
        return mockQueryBuilder({ data: newProfile })
      }
      return mockQueryBuilder({ data: [] })
    })

    invoke.mockResolvedValue({
      data: { ok: true, user_id: 'u-new', email_sent: true },
      error: null,
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await screen.findByRole('heading', { name: /kenting/i })
    await user.click(screen.getByRole('button', { name: /add diver/i }))

    const dialog = await screen.findByRole('dialog', { name: /add diver to event/i })
    await user.click(within(dialog).getByRole('button', { name: /create new diver account/i }))

    // Form fields visible.
    const form = await screen.findByRole('heading', { name: /create new diver account/i })
    expect(form).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^email \*$/i), 'eve@example.com')
    await user.type(screen.getByLabelText(/^name \*/i), 'Eve Tester')
    await user.type(screen.getByLabelText(/^nickname$/i), 'Eve')

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('admin-create-diver', expect.anything()))
    const invokeArgs = invoke.mock.calls[0]?.[1] as { body: Record<string, unknown> }
    expect(invokeArgs.body).toMatchObject({
      email: 'eve@example.com',
      name: 'Eve Tester',
      nickname: 'Eve',
      event_title: 'Kenting',
    })

    // Modal jumps to step C — RegisterFormBody Step 1 of 4 for the new diver.
    await screen.findByText(/Step 1 of 4/i)
    expect(screen.getByRole('heading', { name: /Register Eve/i })).toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('exports diver info via the export-event-divers edge function', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))
    from.mockImplementation(() => mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: { ok: true, diver_count: 7, staff_count: 2 }, error: null })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    // Opens the boat-manifest modal; the export fires on confirm.
    await user.click(await screen.findByRole('button', { name: /export diver info/i }))
    await user.click(await screen.findByRole('button', { name: /export & email/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith(
      'export-event-divers',
      { body: expect.objectContaining({
        event_type: 'dive',
        event_id: 'dive_x',
        boat: expect.objectContaining({
          boat_name: expect.any(String),
          registration: expect.any(String),
          notes: expect.any(Array),
        }),
      }) },
    ))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(expect.stringMatching(/7 divers \+ 2 staff/)))
  })

  it('flags diver notes on the registrant card and shows them inline when expanded', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      event_id: 'dive_x', notes: null, refund_requested_at: null,
      details: {},
    }]
    const profiles = [{
      id: 'u1', name: 'Ada Lovelace', nickname: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
      logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null,
      contact_method: null, contact_id: null,
    }]
    const diverNotes = [
      { id: 'n1', profile_id: 'u1', created_by: 'staff-1', content: 'Severe shellfish allergy',
        created_at: '2026-04-25T10:00:00Z', edited_by: null, edited_at: null },
      { id: 'n2', profile_id: 'u1', created_by: 'staff-1', content: 'Carries her own dive computer',
        created_at: '2026-04-26T11:00:00Z', edited_by: null, edited_at: null },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'bookings')    return mockQueryBuilder({ data: bookings })
      if (table === 'profiles')    return mockQueryBuilder({ data: profiles })
      if (table === 'diver_notes') return mockQueryBuilder({ data: diverNotes })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    // Collapsed view: count flag visible.
    await screen.findByText(/2 diver notes/i)

    // Expand the card → both notes visible in the rose-bordered block.
    await user.click(screen.getByRole('button', { expanded: false, name: /Ada Lovelace/ }))
    await waitFor(() => {
      expect(screen.getByText('Severe shellfish allergy')).toBeInTheDocument()
      expect(screen.getByText('Carries her own dive computer')).toBeInTheDocument()
    })
  })

  it('shows the section tabs even with no registrants, so an admin can set up transport before anyone books', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_empty', { id: 'dive_empty', type: 'dive', title: 'Fresh Dive', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: [] })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_empty')

    // The tab row is present despite zero registrants.
    expect(await screen.findByRole('tab', { name: /^transportation$/i })).toBeInTheDocument()
    expect(screen.getByText(/no one has registered for this event yet/i)).toBeInTheDocument()

    // Transportation is reachable and renders its (empty) ride-choice panel.
    await user.click(screen.getByRole('tab', { name: /^transportation$/i }))
    expect(await screen.findByRole('group', { name: /ride choices/i })).toBeInTheDocument()
  })

  it('Transportation tab lets an admin set each diver\'s ride choice and excludes cancelled bookings', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    const bookings = [
      { id: 'b-needs-1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null,
        details: { transportation: true } },
      { id: 'b-needs-2', user_id: 'u2', status: 'pending', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null,
        details: { transportation: true } },
      { id: 'b-self',    user_id: 'u3', status: 'confirmed', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null,
        details: { transportation: false } },
      { id: 'b-legacy',  user_id: 'u4', status: 'confirmed', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null,
        details: {} },
      { id: 'b-cancel',  user_id: 'u5', status: 'cancelled', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null,
        details: { transportation: true } },
    ]
    const profiles = [
      { id: 'u1', name: 'Ada Lovelace',  nickname: 'Ada',  cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u2', name: 'Bob Roberts',   nickname: null,   cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u3', name: 'Carol Carlson', nickname: null,   cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u4', name: 'Dave Diver',    nickname: null,   cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u5', name: 'Eve Tester',    nickname: null,   cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await screen.findByText('Ada Lovelace')
    await user.click(screen.getByRole('tab', { name: /^transportation$/i }))

    // Admin sees an editable "Ride choices" list with every active diver and
    // their current choice reflected on the segmented control.
    const choices = await screen.findByRole('group', { name: /ride choices/i })
    const rowOf = (name: string) => within(choices).getByText(name).closest('li') as HTMLElement

    expect(within(rowOf('Ada Lovelace')).getByRole('button', { name: 'Needs ride' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(rowOf('Carol Carlson')).getByRole('button', { name: 'Self' })).toHaveAttribute('aria-pressed', 'true')
    // Legacy (unspecified) diver: neither option pre-selected.
    expect(within(rowOf('Dave Diver')).getByRole('button', { name: 'Needs ride' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(rowOf('Dave Diver')).getByRole('button', { name: 'Self' })).toHaveAttribute('aria-pressed', 'false')

    // Cancelled diver excluded, with a footer note explaining why.
    expect(screen.queryByText('Eve Tester')).not.toBeInTheDocument()
    expect(screen.getByText(/cancelled bookings hidden/i)).toBeInTheDocument()

    // Flipping Ada to Self updates her control (logistics-only; persisted via
    // the mocked bookings update).
    await user.click(within(rowOf('Ada Lovelace')).getByRole('button', { name: 'Self' }))
    expect(within(rowOf('Ada Lovelace')).getByRole('button', { name: 'Self' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('surfaces the export error from the edge function', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))
    from.mockImplementation(() => mockQueryBuilder({ data: [] }))
    invoke.mockResolvedValue({ data: null, error: { message: 'email failed: smtp down' } })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    await user.click(await screen.findByRole('button', { name: /export diver info/i }))
    await user.click(await screen.findByRole('button', { name: /export & email/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/Export failed.*smtp down/)))
  })

  it('shows lead-payer badges, records one group payment, and can bill a covered diver back to themselves', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))
    const bookings = [
      { id: 'b-lead', user_id: 'u1', payer_id: 'u1', group_id: 'g1', status: 'confirmed', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: { total: 3000, deposit: 1000 } },
      { id: 'b-kid',  user_id: 'u2', payer_id: 'u1', group_id: 'g1', status: 'pending', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: { total: 3000, deposit: 1000 } },
    ]
    const profiles = [
      { id: 'u1', name: 'Parent Pat', nickname: null, cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u2', name: 'Kid Casey',  nickname: null, cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
    ]
    const bookingsUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
    from.mockImplementation((table: string) => {
      if (table === 'bookings') {
        const qb = mockQueryBuilder({ data: bookings })
        ;(qb as unknown as { update: unknown }).update = bookingsUpdate
        return qb
      }
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })
    rpc.mockResolvedValue({ data: 2000, error: null })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    // Badges: the lead's own card reads "Lead payer"; the child's "Paid by Parent Pat".
    await screen.findByText('Parent Pat')
    expect(screen.getByText('Lead payer')).toBeInTheDocument()
    expect(screen.getByText(/Paid by Parent Pat/)).toBeInTheDocument()

    // Expand the lead's card (its row carries the "Lead payer" badge) and
    // record one group payment → calls the RPC.
    await user.click(screen.getByRole('button', { name: /Lead payer/ }))
    const amount = await screen.findByPlaceholderText(/amount received/i)
    await user.type(amount, '2000')
    await user.click(screen.getByRole('button', { name: /^record$/i }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('record_group_payment', { p_lead: 'u1', p_amount: 2000, p_group_id: 'g1' }))

    // Expand the child's card and bill it back to the diver → clears payer_id.
    await user.click(screen.getByRole('button', { name: /Kid Casey/ }))
    await user.click(screen.getByRole('button', { name: /bill to this diver/i }))
    await waitFor(() => expect(bookingsUpdate).toHaveBeenCalledWith({ payer_id: null }))
  })

  it('Amount owed tab lists each diver\'s balance and the event\'s outstanding total', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))
    const bookings = [
      { id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: { total: 3000 } },
      { id: 'b2', user_id: 'u2', status: 'pending', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: { total: 3000 } },
    ]
    const profiles = [
      { id: 'u1', name: 'Ada Lovelace', nickname: null, cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u2', name: 'Bob Roberts',  nickname: null, cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
    ]
    // Ada paid in full (3000); Bob has paid nothing → 3000 outstanding.
    const payments = [
      { id: 'p1', user_id: 'u1', booking_id: 'b1', amount: 3000, currency: 'TWD', status: 'paid', method: 'Bank', note: null, created_at: '2026-04-21', recorded_by: null },
    ]
    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      if (table === 'payments') return mockQueryBuilder({ data: payments })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')
    await screen.findByText('Ada Lovelace')

    await user.click(screen.getByRole('tab', { name: /amount owed/i }))
    const owed = await screen.findByRole('heading', { name: /amount owed/i })
    const panel = owed.closest('section')!
    // Bob still owes 3000; Ada is settled; the event total reflects Bob.
    expect(within(panel).getByText(/Bob Roberts/)).toBeInTheDocument()
    expect(within(panel).getByText(/3,000 due/)).toBeInTheDocument()
    expect(within(panel).getByText(/Settled/)).toBeInTheDocument()
    expect(within(panel).getByText(/3,000 outstanding/)).toBeInTheDocument()
  })

  it('hides cancelled bookings from the roster and counts, surfacing them only in a collapsed disclosure', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    // Bob registered, cancelled, then re-registered for the same event — a
    // stale cancelled row alongside a fresh confirmed one. Eve simply cancelled.
    const bookings = [
      { id: 'b-bob-old', user_id: 'u2', status: 'cancelled', created_at: '2026-04-19',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: {} },
      { id: 'b-ada',     user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: {} },
      { id: 'b-bob-new', user_id: 'u2', status: 'confirmed', created_at: '2026-04-21',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: {} },
      { id: 'b-eve',     user_id: 'u5', status: 'cancelled', created_at: '2026-04-20',
        event_id: 'dive_x', notes: null, refund_requested_at: null, details: {} },
    ]
    const profiles = [
      { id: 'u1', name: 'Ada Lovelace', nickname: null, cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u2', name: 'Bob Roberts',  nickname: null, cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
      { id: 'u5', name: 'Eve Tester',   nickname: null, cert_agency: null, cert_level: null, nitrox_certified: false, logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null, contact_method: null, contact_id: null },
    ]

    from.mockImplementation((table: string) => {
      if (table === 'bookings') return mockQueryBuilder({ data: bookings })
      if (table === 'profiles') return mockQueryBuilder({ data: profiles })
      return mockQueryBuilder({ data: [] })
    })

    const user = userEvent.setup()
    renderAt('/admin/events/dive/dive_x')

    // Roster + tab count reflect only the 2 active divers (Ada + re-registered Bob).
    await screen.findByText('Ada Lovelace')
    expect(screen.getByRole('tab', { name: /registrants \(2\)/i })).toBeInTheDocument()

    const details = screen.getByText(/cancelled \(2\)/i).closest('details') as HTMLElement
    // The re-registered Bob shows in the active roster (outside the disclosure).
    expect(screen.getAllByText('Bob Roberts').some(el => !details.contains(el))).toBe(true)

    // Eve's cancelled booking is in the DOM but tucked inside the collapsed
    // disclosure, so the admin doesn't see her in the active roster.
    expect(within(details).getByText('Eve Tester')).not.toBeVisible()

    // Expanding the disclosure reveals the cancelled rows (still restorable).
    await user.click(screen.getByText(/cancelled \(2\)/i))
    await waitFor(() => expect(within(details).getByText('Eve Tester')).toBeVisible())
  })
})
