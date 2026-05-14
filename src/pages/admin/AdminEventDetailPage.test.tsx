import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminEventDetailPage } from './AdminEventDetailPage'
import { mockQueryBuilder } from '../../../tests/test-utils'

const { from, invoke, useAuthMock, fetchEventsForBookings } = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
  useAuthMock: vi.fn(),
  fetchEventsForBookings: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
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
      { _id: 'addon-a', display_title: 'SMB Rental', admin_title: 'SMB' },
      { _id: 'addon-b', display_title: 'Camera Rental (1 Dive)', admin_title: 'Cam' },
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

    // Add-ons now visible, rendered as display_title, not raw _id.
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
      { id: 'u-ada',  full_name: 'Ada Lovelace',     display_name: 'Ada',
        cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
        logged_dives: 0, phone: null, contact_method: null, contact_id: null,
        height_cm: null, weight_kg: null, shoe_size: null, status: 'active' },
      { id: 'u-bob',  full_name: 'Bob Roberts',      display_name: null,
        cert_agency: 'PADI', cert_level: 'OW', nitrox_certified: false,
        logged_dives: 0, phone: null, contact_method: null, contact_id: null,
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

  it('records a deposit payment and auto-promotes a pending booking to confirmed', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'pending', created_at: '2026-04-20',
      eo_dive_id: 'dive_x', eo_course_id: null, notes: null, refund_requested_at: null,
      details: { total: 4900, deposit: 4900, payment_method: 'cash' },
    }]
    const profiles = [{
      id: 'u1', full_name: 'Ada Lovelace', display_name: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
      logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null,
      phone: null, contact_method: null, contact_id: null,
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
    await user.click(await screen.findByRole('button', { name: /mark deposit paid \(4,900\)/i }))

    await waitFor(() => expect(paymentInsert).toHaveBeenCalled())
    const insertedPayment = paymentInsert.mock.calls[0]?.[0] as Record<string, unknown>
    expect(insertedPayment).toMatchObject({
      user_id: 'u1', booking_id: 'b1', amount: 4900, status: 'paid', method: 'cash', note: 'Deposit',
    })

    await waitFor(() => expect(bookingUpdate).toHaveBeenCalledWith({ status: 'confirmed' }))
  })

  it('records a custom partial balance payment without promoting status', async () => {
    fetchEventsForBookings.mockResolvedValue(new Map([
      ['dive_x', { id: 'dive_x', type: 'dive', title: 'Kenting', start_time: new Date().toISOString(), end_time: null, currency: 'TWD' }],
    ]))

    // confirmed booking with deposit already paid; admin records partial balance.
    const bookings = [{
      id: 'b1', user_id: 'u1', status: 'confirmed', created_at: '2026-04-20',
      eo_dive_id: 'dive_x', eo_course_id: null, notes: null, refund_requested_at: null,
      details: { total: 12000, deposit: 2000, payment_method: 'bank_transfer' },
    }]
    const profiles = [{
      id: 'u1', full_name: 'Ada Lovelace', display_name: 'Ada',
      cert_agency: 'PADI', cert_level: 'AOW', nitrox_certified: false,
      logged_dives: 0, height_cm: null, weight_kg: null, shoe_size: null,
      phone: null, contact_method: null, contact_id: null,
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
      id: 'u-new', full_name: 'Eve Tester', display_name: 'Eve', name_alt: null,
      cert_agency: null, cert_level: null, nitrox_certified: false,
      logged_dives: 0, phone: null, contact_method: null, contact_id: null,
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
    await user.type(screen.getByLabelText(/^full name \*$/i), 'Eve Tester')
    await user.type(screen.getByLabelText(/^display name$/i), 'Eve')

    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('admin-create-diver', expect.anything()))
    const invokeArgs = invoke.mock.calls[0]?.[1] as { body: Record<string, unknown> }
    expect(invokeArgs.body).toMatchObject({
      email: 'eve@example.com',
      full_name: 'Eve Tester',
      display_name: 'Eve',
      event_title: 'Kenting',
    })

    // Modal jumps to step C — RegisterFormBody Step 1 of 4 for the new diver.
    await screen.findByText(/Step 1 of 4/i)
    expect(screen.getByRole('heading', { name: /Register Eve/i })).toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalled()
  })
})
