import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RegisterForm, RegisterFormBody } from './RegisterForm'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { AppEvent, EOAddon, EORoom, Profile } from '../../types/database'

const { from, update, invoke, setSession } = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
  setSession: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { setSession: (...a: unknown[]) => setSession(...a) },
  },
}))

const sampleEvent: AppEvent = {
  id: 'dive_abc', type: 'dive', title: 'Kenting 2-dive',
  start_time: new Date(Date.now() + 86_400_000).toISOString(),
  end_time: null, featured: false, fully_booked: false,
  price: 2800, currency: 'TWD',
  has_rooms: true, room_type_ids: ['room-a'],
  has_addons: true, addon_ids: ['addon-a'],
  gear_rental_info: 'Full set 1500/day',
  nitrox_required: true, dive_days: 1,
}

const noExtrasEvent: AppEvent = {
  id: 'course_xyz', type: 'course', title: 'EFR Course',
  start_time: new Date(Date.now() + 86_400_000).toISOString(),
  end_time: null, featured: false, fully_booked: false,
  price: 4900, currency: 'TWD',
  has_rooms: false, room_type_ids: [],
  has_addons: false, addon_ids: [],
  gear_rental_info: null, nitrox_required: false, dive_days: 0,
}

const sampleProfile: Profile = {
  id: 'u1', created_at: '', updated_at: '',
  full_name: 'Ada', display_name: 'Ada', phone: null,
  date_of_birth: null, nationality: null, id_number: null,
  emergency_contact_name: null, emergency_contact_phone: null,
  cert_agency: 'PADI', cert_level: 'Advanced Open Water',
  cert_number: null, cert_date: null, medical_notes: null,
  avatar_url: null, role: 'diver',
  height_cm: 170, weight_kg: 65, shoe_size: 'EU 40',
  gender: 'female', contact_method: 'line', contact_id: 'ada-line',
  nitrox_certified: false, logged_dives: 12, last_dive_date: null,
  gear_owned: [],
}

const sampleRooms: EORoom[] = [
  { _id: 'room-a', title: 'kenting_double', display_name: 'Kenting Double', added_price: 1700, currency: 'NTD' },
]
const sampleAddons: EOAddon[] = [
  { _id: 'addon-a', title: 'SMB 1 Day', display_name: null, price: 100, currency: 'NTD' },
]

function setupFrom(updated: unknown = { id: 'b-existing' }) {
  from.mockImplementation((table: string) => {
    if (table === 'EO_rooms')     return mockQueryBuilder({ data: sampleRooms })
    if (table === 'Other_Addons') return mockQueryBuilder({ data: sampleAddons })
    if (table === 'bookings') {
      // New bookings now go through the create-registration edge function;
      // only the admin-edit path still hits bookings.update directly.
      return {
        ...mockQueryBuilder(),
        update: (...a: unknown[]) => {
          update(...a)
          return {
            eq: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: updated, error: null }),
              }),
            }),
          }
        },
      }
    }
    return mockQueryBuilder()
  })
}

beforeEach(() => {
  from.mockReset(); update.mockReset()
  invoke.mockReset(); setSession.mockReset()
  invoke.mockResolvedValue({ data: { booking_id: 'b-new', session: null }, error: null })
  setSession.mockResolvedValue({ data: null, error: null })
})

describe('RegisterForm', () => {
  it('walks through 4 steps and submits a minimal booking with empty details structure', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked} />
    )

    // Step 1 (event) → 2 (about you)
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 2 → 3 (extras) — sampleProfile has full_name so step-2 Next isn't gated
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 3 → 4 (payment)
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 4: confirm
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const [fnName, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }]
    expect(fnName).toBe('create-registration')
    expect(opts.body).toMatchObject({
      event_type: 'dive',
      event_id: 'dive_abc',
    })
    // Authed path: no email/password ride-along on the body.
    expect(opts.body).not.toHaveProperty('email')
    expect(opts.body).not.toHaveProperty('password')
    const details = opts.body.details as { gear: { rent: boolean }; transportation: boolean; payment_method: string }
    expect(details.gear.rent).toBe(false)
    expect(details.transportation).toBe(false)
    expect(details.payment_method).toBe('bank_transfer')

    await waitFor(() => expect(onBooked).toHaveBeenCalledOnce())
    expect(onBooked.mock.calls[0][0]).toEqual({ id: 'b-new' })
  })

  it('includes gear items and add-ons in the details payload', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()
    // Diver "owns everything" so the a-la-carte list starts empty and
    // clicking Wetsuit adds only Wetsuit (keeps the original test intent).
    const profileOwnsAll: Profile = {
      ...sampleProfile,
      gear_owned: ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots'],
    }
    render(
      <RegisterForm event={sampleEvent} profile={profileOwnsAll} userId="u1"
        onClose={() => {}} onBooked={onBooked} />
    )
    // Step 1 → 2 (about you) → 3 (extras)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Wait for async room/addon fetch to populate the extras step
    await screen.findByLabelText(/SMB 1 Day/i)

    // Step 3: turn on gear, pick à-la-carte + Wetsuit
    await user.click(screen.getByLabelText(/rent gear/i))
    const gearSelect = await screen.findByDisplayValue(/full set/i)
    await user.selectOptions(gearSelect, 'a-la-carte')
    await user.click(await screen.findByLabelText(/wetsuit/i))

    // Transport, Nitrox course, one add-on
    await user.click(screen.getByLabelText(/need transportation/i))
    await user.click(screen.getByLabelText(/add nitrox course/i))
    await user.click(screen.getByLabelText(/SMB 1 Day/i))

    // Step 3 → 4 → confirm
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const opts = invoke.mock.calls[0][1] as { body: Record<string, unknown> }
    const details = opts.body.details as {
      gear: { rent: boolean; mode: string; items: string[] }
      add_ons: string[]
      transportation: boolean
      nitrox_course_addon: boolean
      total: number
    }
    expect(details.gear.rent).toBe(true)
    expect(details.gear.mode).toBe('a-la-carte')
    expect(details.gear.items).toContain('Wetsuit')
    expect(details.add_ons).toContain('addon-a')
    expect(details.transportation).toBe(true)
    expect(details.nitrox_course_addon).toBe(true)
    // base 2800 + gear wetsuit 200 + transport 1300 + nitrox 6000 + addon 100 = 10400
    expect(details.total).toBe(10400)
  })

  it('hides gear/room/addon/nitrox sections when the event does not offer them', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={noExtrasEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    // Step 1 → 2 (about you) → 3 (extras)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 3 should show "no extras" copy and hide all optional sections
    expect(await screen.findByText(/no extras/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/rent gear/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^room$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^add-ons$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/add nitrox course/i)).not.toBeInTheDocument()
    // Transportation is always available
    expect(screen.getByLabelText(/need transportation/i)).toBeInTheDocument()
  })

  it('prefills a-la-carte rental list with items the diver does NOT already own', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm
        event={sampleEvent}
        profile={{ ...sampleProfile, gear_owned: ['BCD', 'Regulator', 'Fins'] }}
        userId="u1"
        onClose={() => {}}
        onBooked={() => {}}
      />
    )
    // Step 1 → 2 (about you) → 3 (extras)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    await user.click(screen.getByLabelText(/rent gear/i))
    const gearSelect = await screen.findByDisplayValue(/full set/i)
    await user.selectOptions(gearSelect, 'a-la-carte')

    // Items the diver owns should be unchecked; the rest should be pre-checked.
    await waitFor(() => {
      expect((screen.getByLabelText(/BCD/i) as HTMLInputElement).checked).toBe(false)
      expect((screen.getByLabelText(/Regulator/i) as HTMLInputElement).checked).toBe(false)
      expect((screen.getByLabelText(/Fins/i) as HTMLInputElement).checked).toBe(false)
      expect((screen.getByLabelText(/Wetsuit/i) as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText(/Mask/i) as HTMLInputElement).checked).toBe(true)
      expect((screen.getByLabelText(/Boots/i) as HTMLInputElement).checked).toBe(true)
    })

    // Once the user toggles any item, explicit choice wins (no re-seed on re-render).
    await user.click(screen.getByLabelText(/Wetsuit/i)) // uncheck
    expect((screen.getByLabelText(/Wetsuit/i) as HTMLInputElement).checked).toBe(false)
  })

  it('applies a 5% surcharge for credit card payment on the total', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    // Step 1 → 2 (about you) → 3 (extras) → 4 (payment)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/credit card/i))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.details as { total: number; payment_method: string }
    expect(details.payment_method).toBe('credit_card')
    expect(details.total).toBe(Math.round(2800 * 1.05))
  })

  it('step 2 Next is gated on full-name being set (enforces the one required field)', async () => {
    setupFrom()
    const user = userEvent.setup()
    const blankProfile: Profile = { ...sampleProfile, full_name: null }
    render(
      <RegisterForm event={sampleEvent} profile={blankProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    // Step 1 → 2: no name pre-filled, Next should be disabled
    await user.click(screen.getByRole('button', { name: /next/i }))
    const next = screen.getByRole('button', { name: /next/i })
    expect(next).toBeDisabled()
    await user.type(screen.getByLabelText(/full name/i), 'Grace Hopper')
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('guest path: invokes create-registration with email/password + payload, then setSession on the returned token', async () => {
    setupFrom()
    invoke.mockResolvedValueOnce({
      data: {
        booking_id: 'b-guest-new',
        session: { access_token: 'ACCESS', refresh_token: 'REFRESH' },
      },
      error: null,
    })
    const onBooked = vi.fn()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RegisterFormBody event={sampleEvent} profile={null} onSubmitSuccess={onBooked} />
      </MemoryRouter>
    )

    // Step 1 → 2 (about you with the new-account section, because !userId).
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(screen.getByLabelText(/email \*/i), 'new@diver.test')
    await user.type(screen.getByLabelText(/password/i), 'abcdefgh')
    await user.click(screen.getByLabelText(/I agree to the/i))
    await user.type(screen.getByLabelText(/full name/i), 'Grace Hopper')
    // Step 2 → 3 → 4 → confirm
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const [fnName, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }]
    expect(fnName).toBe('create-registration')
    expect(opts.body).toMatchObject({
      email:      'new@diver.test',
      password:   'abcdefgh',
      event_type: 'dive',
      event_id:   'dive_abc',
    })
    expect(typeof opts.body.agreed_to_terms_at).toBe('string')
    expect(opts.body.profile_patch).toMatchObject({ full_name: 'Grace Hopper' })

    // Session token from the function gets handed to setSession so the
    // diver lands authed without a second round-trip.
    await waitFor(() => expect(setSession).toHaveBeenCalledWith({ access_token: 'ACCESS', refresh_token: 'REFRESH' }))
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith({ id: 'b-guest-new' }))
  })

  it('in edit mode, pre-populates state from the existing booking and UPDATEs on submit', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()

    const existing = {
      id: 'b-existing',
      user_id: 'u1',
      status: 'pending',
      notes: 'allergic to shellfish',
      details: {
        gear: { rent: true, mode: 'a-la-carte', items: ['Fins', 'Mask'] },
        add_ons: [],
        transportation: true,
        payment_method: 'cash',
        total: 3000,
      },
    } as unknown as Parameters<typeof RegisterForm>[0]['existingBooking']

    render(
      <RegisterForm
        event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked}
        existingBooking={existing}
      />
    )

    // Step 1 (event) → 2 (about you) → 3 (extras): the gear picker should reflect
    // the existing booking.
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => {
      expect((screen.getByLabelText(/rent gear/i) as HTMLInputElement).checked).toBe(true)
      expect((screen.getByDisplayValue(/à-la-carte/i) as HTMLSelectElement).value).toBe('a-la-carte')
    })
    // Items checked to match the existing booking's a-la-carte list, not the
    // profile's gear_owned (which would otherwise seed a different set).
    expect((screen.getByLabelText(/Fins/i) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/Mask/i) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/BCD/i) as HTMLInputElement).checked).toBe(false)

    // Step 3 → 4 (payment): submit button says "Save changes", not "Confirm booking".
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    // The `update` spy is wired to bookings only (profiles routes to the
    // generic thenable builder), so exactly one call expected.
    await waitFor(() => expect(update).toHaveBeenCalledOnce())
    const payload = update.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toHaveProperty('details')
    expect(payload).toHaveProperty('notes', 'allergic to shellfish')
    expect(onBooked).toHaveBeenCalled()
    // Admin edits stay direct — no edge function, no fresh PDF email.
    expect(invoke).not.toHaveBeenCalled()
  })
})
