import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// The form reads the viewer's role to decide whether to block past-event
// registration. Default to a diver; the sample events are future-dated so the
// block stays off for the existing flow tests.
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ profile: { role: 'diver' } }),
}))

// Stub the Turnstile widget so guest tests can "solve" the captcha without
// loading Cloudflare's script: clicking the button hands a token to the form,
// the same contract the real widget fulfils via its onToken callback.
vi.mock('./TurnstileWidget', () => ({
  TurnstileWidget: ({ onToken }: { onToken: (t: string) => void }) => (
    <button type="button" onClick={() => onToken('test-turnstile-token')}>solve captcha</button>
  ),
}))

const sampleEvent: AppEvent = {
  id: 'dive_abc', type: 'dive', title: 'Kenting 2-dive',
  start_time: '2027-05-15T00:00:00.000Z',
  end_time: null, start_time_hhmm: null,
  featured: false, fully_booked: false,
  price: 2800, deposit_amount: 1000, transport_price: 1300, currency: 'TWD',
  has_rooms: true, room_type_ids: ['room-a'],
  has_addons: true, addon_ids: ['addon-a'],
  gear_rental_info: 'Full set 1500/day',
  nitrox_required: true, dive_days: 1,
  cancelled_at: null,
  full_payment_deadline: '2027-05-08',
  cancel_policy: null,
  cancel_date: null,
}

const noExtrasEvent: AppEvent = {
  id: 'dive_noextras', type: 'dive', title: 'Quiet shore dive',
  start_time: '2027-05-15T00:00:00.000Z',
  end_time: null, start_time_hhmm: null,
  featured: false, fully_booked: false,
  // `noExtrasEvent` has no transport surcharge — the form should show the
  // "included in base price" copy and skip the checkbox.
  price: 4900, deposit_amount: null, transport_price: null, currency: 'TWD',
  has_rooms: false, room_type_ids: [],
  has_addons: false, addon_ids: [],
  gear_rental_info: null, nitrox_required: false, dive_days: 0,
  cancelled_at: null,
  full_payment_deadline: null,
  cancel_policy: null, cancel_date: null,
}

const sampleProfile: Profile = {
  id: 'u1', created_at: '', updated_at: '',
  name: 'Ada', nickname: 'Ada',
  date_of_birth: null, nationality: 'British', id_number: null,
  emergency_contact_name: null, emergency_contact_phone: null,
  cert_agency: 'PADI', cert_level: 'Advanced Open Water',
  cert_number: null, cert_date: null,
  cert_card_path: 'u1/existing-card.jpg',
  nitrox_card_path: null, medical_notes: null,
  avatar_url: null, role: 'diver',
  height_cm: 170, weight_kg: 65, shoe_size: 'EU 40',
  gender: 'female', contact_method: 'line', contact_id: 'ada-line',
  nitrox_certified: false, logged_dives: 12, last_dive_date: null,
  gear_owned: [],
}

const sampleRooms: EORoom[] = [
  { _id: 'room-a', admin_title: 'kenting_double', display_title: 'Kenting Double', added_price: 1700, currency: 'NTD' },
]
const sampleAddons: EOAddon[] = [
  { _id: 'addon-a', admin_title: 'SMB 1 Day', display_title: null, price: 100, currency: 'NTD' },
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
  // Default: a site key is present so the captcha widget renders. Individual
  // tests override this to exercise the missing-key guardrail.
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('RegisterForm', () => {
  it('blocks a diver from registering for a past event', async () => {
    setupFrom()
    render(
      <RegisterForm
        event={{ ...sampleEvent, start_time: '2020-01-01T00:00:00.000Z', full_payment_deadline: null }}
        profile={sampleProfile}
        userId="u1"
        onClose={() => {}}
        onBooked={() => {}}
      />
    )
    expect(await screen.findByText(/already taken place/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

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
    // Step 2 → 3 (extras) — sampleProfile has name so step-2 Next isn't gated
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Transport is required; pick "no" so the Next button on step 3 is enabled.
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
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
    expect(onBooked.mock.calls[0][0]).toEqual({ id: 'b-new', status: 'pending' })
  })

  it('shows an in-flight "Confirming…" state while the submit round-trip is pending', async () => {
    setupFrom()
    // Hold the edge-function call open so we can observe the button mid-flight
    // — this is the gap that previously looked frozen.
    let resolveInvoke!: (v: unknown) => void
    invoke.mockReturnValueOnce(new Promise(res => { resolveInvoke = res }))
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    const busy = await screen.findByRole('button', { name: /confirming/i })
    expect(busy).toBeDisabled()

    resolveInvoke({ data: { booking_id: 'b-new', session: null }, error: null })
    await waitFor(() => expect(screen.getByRole('button', { name: /confirm booking/i })).toBeInTheDocument())
  })

  it('includes gear items and add-ons in the details payload', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()
    // Diver "owns everything" so the a-la-carte list starts empty and
    // clicking Wetsuit adds only Wetsuit (keeps the original test intent).
    const profileOwnsAll: Profile = {
      ...sampleProfile,
      gear_owned: ['BCD', 'Regulator', 'Wetsuit', 'Fins', 'Mask', 'Boots', 'Dive computer'],
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

    // Step 3: choose "I need to rent" (à-la-carte is the only mode), pick Wetsuit
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(await screen.findByLabelText(/wetsuit/i))

    // Transport, Nitrox course, one add-on
    await user.click(screen.getByLabelText(/ride with the shop/i))
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
      charges: Array<{ kind: string; label: string; amount: number }>
    }
    expect(details.gear.rent).toBe(true)
    expect(details.gear.mode).toBe('a-la-carte')
    expect(details.gear.items).toContain('Wetsuit')
    expect(details.add_ons).toContain('addon-a')
    expect(details.transportation).toBe(true)
    expect(details.nitrox_course_addon).toBe(true)
    // base 2800 + gear wetsuit 200 + transport 1300 + nitrox 6000 + addon 100 = 10400
    expect(details.total).toBe(10400)
    // The itemized snapshot mirrors the total, line by line.
    expect(details.charges.map(c => [c.label, c.amount])).toEqual([
      ['Base', 2800],
      ['Gear: Wetsuit', 200],
      ['Add-on: SMB 1 Day', 100],
      ['Transport', 1300],
      ['Nitrox course', 6000],
    ])
    expect(details.charges.reduce((s, c) => s + c.amount, 0)).toBe(details.total)
  })

  it('requires a shoe size to rent fins and saves it to the profile', async () => {
    setupFrom()
    const user = userEvent.setup()
    // Owns everything except fins, and has no shoe size on file.
    const profile: Profile = {
      ...sampleProfile,
      shoe_size: null,
      gear_owned: ['BCD', 'Regulator', 'Wetsuit', 'Mask', 'Boots', 'Dive computer'],
    }
    render(<RegisterForm event={sampleEvent} profile={profile} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))

    // Fins is the only un-owned item, so it's pre-checked → shoe size required.
    expect(await screen.findByText(/we need your sizes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Shoe size value'), '40')
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const body = invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown> } }
    expect(body.body.profile_patch.shoe_size).toBe('EU 40 M')
  })

  it('requires height and weight to rent a wetsuit', async () => {
    setupFrom()
    const user = userEvent.setup()
    // Owns everything except the wetsuit, and has no height/weight on file.
    const profile: Profile = {
      ...sampleProfile,
      height_cm: null,
      weight_kg: null,
      gear_owned: ['BCD', 'Regulator', 'Fins', 'Mask', 'Boots', 'Dive computer'],
    }
    render(<RegisterForm event={sampleEvent} profile={profile} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))

    expect(await screen.findByText(/we need your sizes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/height \(cm\)/i), '175')
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled() // weight still missing
    await user.type(screen.getByLabelText(/weight \(kg\)/i), '70')
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  it('does not prompt for sizes when the profile already has them', async () => {
    setupFrom()
    const user = userEvent.setup()
    // sampleProfile has height/weight/shoe; owns nothing so renting all items.
    render(<RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: [] }} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    expect(screen.queryByText(/we need your sizes/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
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
    expect(screen.queryByLabelText(/i need to rent/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^room$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^add-ons$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/add nitrox course/i)).not.toBeInTheDocument()
    // Transport is included in base price for this event (transport_price = null)
    // → the "Ride with the shop" radio shows an "Included in base price" sub-label.
    expect(screen.getByLabelText(/ride with the shop/i)).toBeInTheDocument()
    expect(screen.getByText(/included in base price/i)).toBeInTheDocument()
  })

  it('Open Water course bundles gear — shows the included note, no rent option', async () => {
    setupFrom()
    const user = userEvent.setup()
    const owCourse: AppEvent = { ...noExtrasEvent, type: 'course', title: 'Open Water Course' }
    render(
      <RegisterForm event={owCourse} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText(/gear is included with this course/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/i need to rent/i)).not.toBeInTheDocument()
  })

  it('Advanced Open Water course offers gear rental (gear is not bundled)', async () => {
    setupFrom()
    const user = userEvent.setup()
    const aowCourse: AppEvent = { ...noExtrasEvent, type: 'course', title: 'Advanced Open Water' }
    render(
      <RegisterForm event={aowCourse} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByLabelText(/i need to rent/i)).toBeInTheDocument()
    expect(screen.queryByText(/gear is included with this course/i)).not.toBeInTheDocument()
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

    await user.click(screen.getByLabelText(/i need to rent/i))

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
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/credit card/i))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.details as { total: number; payment_method: string }
    expect(details.payment_method).toBe('credit_card')
    expect(details.total).toBe(Math.round(2800 * 1.05))
  })

  it('charges the 5% card surcharge on the deposit only (not the full amount) when paying deposit-only by card', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    // sampleEvent: price 2800, deposit_amount 1000.
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/credit card/i))
    await user.click(screen.getByLabelText(/pay deposit only/i))

    // Pay-now is deposit + 5% of the deposit (1000 + 50); the remainder
    // (2800 − 1000 = 1800) carries no card surcharge.
    expect(screen.getByText((_, el) =>
      el?.tagName === 'P' && /pay deposit\s+ASAP\s*:/i.test(el.textContent ?? '') && /1,050/.test(el.textContent ?? '')
    )).toBeInTheDocument()
    expect(screen.getByText((_, el) =>
      el?.tagName === 'P' && /pay remaining balance by/i.test(el.textContent ?? '') && /1,800/.test(el.textContent ?? '')
    )).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.details as { total: number; deposit: number }
    // Total owed = subtotal + 5% of the deposit (2800 + 50), NOT 2800 * 1.05.
    expect(details.total).toBe(2850)
    expect(details.total).not.toBe(Math.round(2800 * 1.05))
    // Stored deposit is surcharge-inclusive (what's charged to the card now).
    expect(details.deposit).toBe(1050)
  })

  it('applies a 5% surcharge for PayPal payment on the total', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/^paypal/i))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body.details as { total: number; payment_method: string }
    expect(details.payment_method).toBe('paypal')
    expect(details.total).toBe(Math.round(2800 * 1.05))
  })

  it('step 3 Next is blocked until the diver answers BOTH the transport and gear questions', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    // Step 1 → 2 → 3
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Nothing pre-checked: neither transport nor gear.
    expect((screen.getByLabelText(/ride with the shop/i) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText(/no, i don't need a ride/i) as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText(/i have all the required gear/i) as HTMLInputElement).checked).toBe(false)

    // Next stays disabled with neither answered.
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    // Answering only transport is not enough — gear is still unanswered.
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    // Answering gear too unblocks it.
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('step 2 Next is gated on full-name being set (enforces the one required field)', async () => {
    setupFrom()
    const user = userEvent.setup()
    const blankProfile: Profile = { ...sampleProfile, name: null }
    render(
      <RegisterForm event={sampleEvent} profile={blankProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    // Step 1 → 2: no name pre-filled, Next should be disabled
    await user.click(screen.getByRole('button', { name: /next/i }))
    const next = screen.getByRole('button', { name: /next/i })
    expect(next).toBeDisabled()
    await user.type(screen.getByLabelText(/^name \*/i), 'Grace Hopper')
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('step 2 Next is blocked when a cert level is filled but no cert card is on file', async () => {
    setupFrom()
    const user = userEvent.setup()
    const noCardProfile: Profile = { ...sampleProfile, cert_level: 'Open Water', cert_card_path: null }
    render(
      <RegisterForm event={sampleEvent} profile={noCardProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/upload a photo of your highest certification card/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    // Clearing the cert level releases the gate (no cert ⇒ no photo required).
    await user.clear(screen.getByLabelText(/cert level/i))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('step 2 Next is allowed when a cert level is filled AND a cert card is already on file', async () => {
    setupFrom()
    const user = userEvent.setup()
    // sampleProfile already has cert_level + cert_card_path set, so this is
    // the default-path assertion: gate stays open, "on file" copy shown.
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/certification card on file/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('step 2 Next is blocked when nitrox is checked but no card is on file and no new photo is picked', async () => {
    setupFrom()
    const user = userEvent.setup()
    // Profile without a nitrox card path — represents a fresh diver who's
    // never uploaded one.
    const noCardProfile: Profile = { ...sampleProfile, nitrox_certified: false, nitrox_card_path: null }
    render(
      <RegisterForm event={sampleEvent} profile={noCardProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Name is pre-filled — Next would be enabled if not for the nitrox gate.
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()

    // Tick nitrox certified → upload prompt appears, Next becomes disabled.
    await user.click(screen.getByLabelText(/nitrox certified/i))
    expect(screen.getByText(/upload a photo of your nitrox certification card/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    // Untick → gate releases.
    await user.click(screen.getByLabelText(/nitrox certified/i))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('step 2 Next is blocked when deep is checked but no card is on file and no new photo is picked', async () => {
    setupFrom()
    const user = userEvent.setup()
    const noDeepProfile: Profile = { ...sampleProfile, deep_certified: false, deep_card_path: null }
    render(
      <RegisterForm event={sampleEvent} profile={noDeepProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()

    // Tick deep certified → upload prompt appears, Next becomes disabled.
    await user.click(screen.getByLabelText(/deep certified/i))
    expect(screen.getByText(/upload a photo of your deep certification card/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    // Untick → gate releases.
    await user.click(screen.getByLabelText(/deep certified/i))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('step 2 Next is allowed when nitrox is checked AND a card is already on file', async () => {
    setupFrom()
    const user = userEvent.setup()
    const withCardProfile: Profile = { ...sampleProfile, nitrox_certified: true, nitrox_card_path: 'u1/card_123.jpg' }
    render(
      <RegisterForm event={sampleEvent} profile={withCardProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/nitrox card on file/i)).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.type(screen.getByLabelText(/^name \*/i), 'Grace Hopper')
    await user.type(screen.getByLabelText(/nationality \*/i), 'American')
    await user.selectOptions(screen.getByLabelText(/gender \*/i), 'female')
    // Step 2 → 3 → 4 → confirm
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const [fnName, opts] = invoke.mock.calls[0] as [string, { body: Record<string, unknown> }]
    expect(fnName).toBe('create-registration')
    expect(opts.body).toMatchObject({
      email:           'new@diver.test',
      password:        'abcdefgh',
      event_type:      'dive',
      event_id:        'dive_abc',
      turnstile_token: 'test-turnstile-token',
    })
    expect(typeof opts.body.agreed_to_terms_at).toBe('string')
    expect(opts.body.profile_patch).toMatchObject({ name: 'Grace Hopper', nationality: 'American', gender: 'female' })

    // Session token from the function gets handed to setSession so the
    // diver lands authed without a second round-trip.
    await waitFor(() => expect(setSession).toHaveBeenCalledWith({ access_token: 'ACCESS', refresh_token: 'REFRESH' }))
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith({ id: 'b-guest-new', status: 'pending' }))
  })

  it('guest path: surfaces the server\'s error body and softens "already registered" with a sign-in hint', async () => {
    setupFrom()
    // FunctionsHttpError shape: .context is a Response, .message is the
    // generic wrapper. The form should pull the body out and then
    // detect the "already registered" case to point users at sign-in.
    const responseBody = { error: 'A user with this email address has already been registered' }
    const ctx = new Response(JSON.stringify(responseBody), { status: 400, headers: { 'content-type': 'application/json' } })
    invoke.mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context: ctx }),
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RegisterFormBody event={sampleEvent} profile={null} onSubmitSuccess={() => {}} />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(screen.getByLabelText(/email \*/i), 'taken@diver.test')
    await user.type(screen.getByLabelText(/password/i), 'abcdefgh')
    await user.click(screen.getByLabelText(/I agree to the/i))
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.type(screen.getByLabelText(/^name \*/i), 'Grace Hopper')
    await user.type(screen.getByLabelText(/nationality \*/i), 'American')
    await user.selectOptions(screen.getByLabelText(/gender \*/i), 'female')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    expect(await screen.findByText(/account with that email already exists/i)).toBeInTheDocument()
    expect(screen.getByText(/sign in/i)).toBeInTheDocument()
  })

  it('guest path: with no Turnstile site key, shows an unavailable notice and blocks advancing past step 2', async () => {
    setupFrom()
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RegisterFormBody event={sampleEvent} profile={null} onSubmitSuccess={() => {}} />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(screen.getByLabelText(/email \*/i), 'new@diver.test')
    await user.type(screen.getByLabelText(/password/i), 'abcdefgh')
    await user.click(screen.getByLabelText(/I agree to the/i))
    await user.type(screen.getByLabelText(/^name \*/i), 'Grace Hopper')

    // No captcha widget renders — the notice replaces it and there is no
    // token, so the only way forward is blocked.
    expect(screen.queryByRole('button', { name: /solve captcha/i })).not.toBeInTheDocument()
    expect(screen.getByText(/registration is temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('uses event.transport_price for the surcharge — when null/0, hides the checkbox and renders "included" copy', async () => {
    setupFrom()
    const user = userEvent.setup()
    // Same as sampleEvent but with transport bundled into the base price.
    const eventInclTransport: AppEvent = { ...sampleEvent, transport_price: null }
    render(
      <RegisterForm event={eventInclTransport} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.getByLabelText(/ride with the shop/i)).toBeInTheDocument()
    expect(screen.getByText(/included in base price/i)).toBeInTheDocument()

    // Confirm submit and assert the cost row excludes a transport line.
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: { details: { transportation: boolean; total: number } } }).body.details
    expect(details.transportation).toBe(false)
    // base 2800 only — no transport surcharge added.
    expect(details.total).toBe(2800)
  })

  it('uses the per-tier transport price when surcharge applies', async () => {
    setupFrom()
    const user = userEvent.setup()
    // event.transport_price = 1300 (from sampleEvent fixture)
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // "Ride with the shop" radio visible with the per-tier price (1300).
    const rideRadio = screen.getByLabelText(/ride with the shop/i)
    expect(rideRadio).toBeInTheDocument()
    await user.click(rideRadio)
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: { details: { transportation: boolean; total: number } } }).body.details
    expect(details.transportation).toBe(true)
    // base 2800 + transport 1300 = 4100
    expect(details.total).toBe(4100)
  })

  it('renders the cancellation policy + ack checkbox when the event has one, and gates submit on the checkbox', async () => {
    // Route cancellation_policies through the mock so the form's lookup resolves.
    const policyRow = {
      _id: 'pol-1',
      title: 'Local Multi-day Trip',
      cancelation_policy: 'Deposit non-refundable. 14 days notice for partial refund.',
    }
    from.mockImplementation((table: string) => {
      if (table === 'EO_rooms')              return mockQueryBuilder({ data: sampleRooms })
      if (table === 'Other_Addons')          return mockQueryBuilder({ data: sampleAddons })
      if (table === 'cancellation_policies') return mockQueryBuilder({ data: policyRow })
      return mockQueryBuilder()
    })

    const eventWithPolicy: AppEvent = {
      ...sampleEvent,
      cancel_policy: 'pol-1',
      cancel_date: '2027-04-15',
    }

    const onBooked = vi.fn()
    const user = userEvent.setup()
    render(
      <RegisterForm event={eventWithPolicy} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Policy heading + body + cancel-by date + checkbox all visible.
    expect(await screen.findByText(/cancellation policy — local multi-day trip/i)).toBeInTheDocument()
    expect(screen.getByText(/deposit non-refundable/i)).toBeInTheDocument()
    expect(screen.getByText(/cancel-by date/i)).toBeInTheDocument()
    const checkbox = screen.getByLabelText(/i have read and agree to the cancellation policy/i)
    expect(checkbox).not.toBeChecked()

    // Confirm-booking is gated until ack.
    const confirm = screen.getByRole('button', { name: /confirm booking/i })
    expect(confirm).toBeDisabled()
    await user.click(checkbox)
    expect(confirm).toBeEnabled()

    await user.click(confirm)
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: { details: { cancellation_policy_acked_at?: string } } }).body.details
    expect(typeof details.cancellation_policy_acked_at).toBe('string')
    expect(details.cancellation_policy_acked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('step 4 renders a per-method "How to pay" block that updates with the selected method', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Default = bank_transfer → local bank-details block.
    expect(screen.getByText(/how to pay — local bank transfer/i)).toBeInTheDocument()
    expect(screen.getByText(/code:/i)).toBeInTheDocument()
    expect(screen.getByText(/branch:/i)).toBeInTheDocument()

    // Switch to PayPal → paypal.me link block.
    await user.click(screen.getByLabelText(/^paypal/i))
    expect(screen.getByText(/how to pay — paypal/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /paypal\.me\/fundiverstw/i })).toBeInTheDocument()

    // Switch to credit card → invoice-email block, defaults to registered email copy.
    await user.click(screen.getByLabelText(/credit card/i))
    expect(screen.getByText(/how to pay — credit card/i)).toBeInTheDocument()
    expect(screen.getByText(/invoice will be sent to/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/invoice email/i)).toBeInTheDocument()

    // Switch to cash → shop address.
    await user.click(screen.getByLabelText(/^cash/i))
    expect(screen.getByText(/how to pay — cash/i)).toBeInTheDocument()
    expect(screen.getByText(/heping st/i)).toBeInTheDocument()
    expect(screen.getByText(/909-083-683/)).toBeInTheDocument()
  })

  it('step 4 always shows the "After you pay" reminder naming all three contact channels, regardless of method', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    const expectReminder = () => {
      expect(screen.getByText(/after you pay/i)).toBeInTheDocument()
      const reminder = screen.getByText(/contact FunDivers by email, LINE, or WhatsApp/i)
      expect(reminder).toBeInTheDocument()
      expect(screen.getByText(/fundivers tw app/i)).toBeInTheDocument()
    }

    // Default = bank_transfer
    expectReminder()

    await user.click(screen.getByLabelText(/^paypal/i))
    expectReminder()

    await user.click(screen.getByLabelText(/credit card/i))
    expectReminder()

    await user.click(screen.getByLabelText(/^cash/i))
    expectReminder()
  })

  it('shows the admin-set deadline summary on step 4 and hides the deposit-only block when paying full', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Deposit is always due ASAP; only the balance carries the admin date.
    expect(screen.getByText((_, el) =>
      el?.tagName === 'P' && /pay deposit\s+ASAP\s+to hold your spot/i.test(el.textContent ?? '')
    )).toBeInTheDocument()
    expect(screen.getByText(/May 8/)).toBeInTheDocument()      // full_payment_deadline

    // Default is "Pay full amount now" → no per-amount breakdown.
    expect(screen.getByLabelText(/pay full amount now/i)).toBeChecked()
    expect(screen.queryByText(/pay remaining balance by/i)).not.toBeInTheDocument()
  })

  it('selecting "deposit only" persists the flag and renders the two-amount breakdown', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    await user.click(screen.getByLabelText(/pay deposit only/i))

    // Two extra lines appear under the summary: deposit ASAP and balance with date.
    expect(screen.getByText((_, el) =>
      el?.tagName === 'P' && /pay deposit\s+ASAP\s*:/i.test(el.textContent ?? '')
    )).toBeInTheDocument()
    expect(screen.getByText((_, el) =>
      el?.tagName === 'P' && /pay remaining balance by/i.test(el.textContent ?? '')
    )).toBeInTheDocument()
    // total 2800, deposit 1000 → remaining 1800
    expect(screen.getByText(/1,800/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const details = (invoke.mock.calls[0][1] as { body: { details: { pay_deposit_only: boolean } } }).body.details
    expect(details.pay_deposit_only).toBe(true)
  })

  it('hides the deposit-only choice entirely when the event has no deposit_amount', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={noExtrasEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.queryByLabelText(/pay deposit only/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/pay full amount now/i)).not.toBeInTheDocument()
    // Summary still renders (with the 7-day fallback since both deadlines are null).
    expect(screen.getByText(/hold your spot/i)).toBeInTheDocument()
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
      expect((screen.getByLabelText(/i need to rent/i) as HTMLInputElement).checked).toBe(true)
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

  it('admin "register on behalf of": submits target_user_id and runs as authed (no email/password)', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RegisterFormBody
          event={sampleEvent}
          profile={sampleProfile}
          userId="diver-99"
          actingOnBehalfOf="diver-99"
          onSubmitSuccess={onBooked}
        />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const opts = invoke.mock.calls[0][1] as { body: Record<string, unknown> }
    expect(opts.body).toMatchObject({
      target_user_id: 'diver-99',
      event_type:     'dive',
      event_id:       'dive_abc',
    })
    // Admin path is authed via JWT, not guest — no signup ride-along.
    expect(opts.body).not.toHaveProperty('email')
    expect(opts.body).not.toHaveProperty('password')
    expect(setSession).not.toHaveBeenCalled()
    expect(onBooked).toHaveBeenCalledWith({ id: 'b-new', status: 'pending' })
  })

  it('admin "register on behalf of": skips required-field gates when diver profile is incomplete', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()
    // Profile is bare bones — no name, cert level set without a card,
    // no nationality, etc. A diver couldn't get past step 2 with this,
    // but the admin path should sail through.
    const sparseProfile: Profile = {
      ...sampleProfile,
      name: null,
      nationality: null,
      gender: null,
      cert_card_path: null,
    }
    render(
      <MemoryRouter>
        <RegisterFormBody
          event={sampleEvent}
          profile={sparseProfile}
          userId="diver-99"
          actingOnBehalfOf="diver-99"
          onSubmitSuccess={onBooked}
        />
      </MemoryRouter>
    )

    // Step 1 → 2.
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Full name left blank, cert_level pre-filled from profile with no
    // card on file — Next should still be enabled.
    expect((screen.getByLabelText(/^name \*/i) as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 3 — don't touch transport; Next should still be enabled.
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 4 — Confirm enabled without any extra interaction.
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const opts = invoke.mock.calls[0][1] as { body: Record<string, unknown> }
    expect(opts.body).toMatchObject({ target_user_id: 'diver-99' })
    // needsTransport stayed null → details.transportation defaults to false.
    expect((opts.body.details as Record<string, unknown>).transportation).toBe(false)
    expect(onBooked).toHaveBeenCalled()
  })

  // Parent diver picker: the linked-children fetch returns rows, the
  // multi-select picker appears, and confirming the selection re-mounts
  // the form with the right primary target and additionalTargets.
  describe('parent diver picker', () => {
    const childProfile: Profile = {
      ...sampleProfile, id: 'child-1', name: 'Bee Junior',
      nickname: 'Bee Jr', cert_level: null, cert_card_path: null,
    }
    const childTwoProfile: Profile = {
      ...sampleProfile, id: 'child-2', name: 'Bee The Second',
      nickname: 'Bee II', cert_level: null, cert_card_path: null,
    }

    function setupFromWithChildren(children: Profile[]) {
      from.mockImplementation((table: string) => {
        if (table === 'EO_rooms')     return mockQueryBuilder({ data: sampleRooms })
        if (table === 'Other_Addons') return mockQueryBuilder({ data: sampleAddons })
        if (table === 'profiles')     return mockQueryBuilder({ data: children })
        return mockQueryBuilder()
      })
    }

    it('shows the picker with self pre-checked plus each child option', async () => {
      setupFromWithChildren([childProfile])
      render(
        <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
          onClose={() => {}} onBooked={() => {}} />
      )
      // Picker swaps in once children resolve.
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      const myself = screen.getByRole('checkbox', { name: /^myself$/i })
      const kid    = screen.getByRole('checkbox', { name: /bee junior/i })
      expect((myself as HTMLInputElement).checked).toBe(true)
      expect((kid as HTMLInputElement).checked).toBe(false)
      // Continue is enabled by default (myself pre-selected).
      expect(screen.getByRole('button', { name: /continue/i })).not.toBeDisabled()
    })

    it('Continue is disabled when no diver is selected', async () => {
      setupFromWithChildren([childProfile])
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
          onClose={() => {}} onBooked={() => {}} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /^myself$/i }))
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    })

    it('does NOT show the picker when no children are linked', async () => {
      setupFromWithChildren([])
      render(
        <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
          onClose={() => {}} onBooked={() => {}} />
      )
      expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument()
      expect(screen.queryByText(/who is this booking for/i)).not.toBeInTheDocument()
    })

    it('selecting only a child threads target_user_id and skips the card upload prompt', async () => {
      setupFromWithChildren([childProfile])
      const onBooked = vi.fn()
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
          onClose={() => {}} onBooked={onBooked} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      // Drop Myself, pick the child.
      await user.click(screen.getByRole('checkbox', { name: /^myself$/i }))
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      // Banner shows the chosen target.
      await waitFor(() => expect(screen.getByText(/booking for: bee junior/i)).toBeInTheDocument())

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /confirm booking/i }))

      await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
      const opts = invoke.mock.calls[0][1] as { body: Record<string, unknown> }
      expect(opts.body).toMatchObject({ target_user_id: 'child-1', event_id: 'dive_abc' })
      expect(opts.body).not.toHaveProperty('group_id')
      expect(onBooked).toHaveBeenCalled()
    })

    it('selecting Myself + child fans out two calls sharing one group_id', async () => {
      setupFromWithChildren([childProfile])
      const onBooked = vi.fn()
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
          onClose={() => {}} onBooked={onBooked} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      // Add the child to the default Myself selection.
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /confirm booking/i }))

      // Two create-registration calls (self + child) plus one group summary.
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
      const regCalls = invoke.mock.calls.filter(c => c[0] === 'create-registration')
      expect(regCalls).toHaveLength(2)
      const bodies = regCalls.map(c => (c[1] as { body: Record<string, unknown> }).body)
      const selfBody  = bodies.find(b => !b.target_user_id)
      const childBody = bodies.find(b => b.target_user_id === 'child-1')

      expect(selfBody).toBeTruthy()
      expect(childBody).toBeTruthy()
      // Both calls share the same group_id.
      expect(selfBody?.group_id).toBeTruthy()
      expect(selfBody?.group_id).toBe(childBody?.group_id)
      // "I'll pay for everyone" defaults on → both bookings carry the parent
      // as payer (the lead's own booking included, so the rollup covers it).
      expect(selfBody?.payer_id).toBe('u1')
      expect(childBody?.payer_id).toBe('u1')
      // Per-diver emails suppressed; one consolidated group summary follows.
      expect(selfBody?.suppress_email).toBe(true)
      expect(childBody?.suppress_email).toBe(true)
      const summaryCall = invoke.mock.calls.find(c => c[0] === 'send-group-summary')!
      expect((summaryCall[1] as { body: { group_id: string } }).body.group_id).toBe(selfBody?.group_id)
      // Child's call carries an empty patch (don't overwrite the child's profile).
      expect(childBody?.profile_patch).toEqual({})
      // Self's call carries the parent's typed-in name.
      expect((selfBody?.profile_patch as Record<string, unknown>).name).toBe('Ada')

      expect(onBooked).toHaveBeenCalled()
    })

    it('shows the cumulative group total when the lead pays for everyone', async () => {
      setupFromWithChildren([childProfile])
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
          onClose={() => {}} onBooked={() => {}} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      // Myself + one child = 2 divers; "I'll pay for everyone" defaults on.
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
      await user.click(screen.getByLabelText(/i have all the required gear/i))
      await user.click(screen.getByRole('button', { name: /next/i }))

      // Per-diver price is the 2,800 event fee; the group total doubles it.
      const perDiver = screen.getByText('Per diver').closest('div')!
      expect(perDiver).toHaveTextContent('TWD 2,800')
      const groupRow = screen.getByText(/group total \(2 divers\)/i).closest('div')!
      expect(groupRow).toHaveTextContent('TWD 5,600')
    })

    it('surfaces per-diver results when an additional child call fails', async () => {
      setupFromWithChildren([childProfile, childTwoProfile])
      const onBooked = vi.fn()
      const user = userEvent.setup()
      // First call (self): ok. Second call (child-1): ok. Third (child-2): fail.
      invoke.mockReset()
      invoke
        .mockResolvedValueOnce({ data: { booking_id: 'b-self', session: null }, error: null })
        .mockResolvedValueOnce({ data: { booking_id: 'b-c1', session: null }, error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'boom', context: undefined } })
      render(
        <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
          onClose={() => {}} onBooked={onBooked} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('checkbox', { name: /bee the second/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /confirm booking/i }))

      await waitFor(() => expect(screen.getByText(/some divers could not be registered/i)).toBeInTheDocument())
      // Per-diver block shows BOTH outcomes.
      expect(screen.getByText(/Bee Jr.*registered/i)).toBeInTheDocument()
      expect(screen.getByText(/Bee II.*failed/i)).toBeInTheDocument()
      // onBooked is only fired when every call succeeded.
      expect(onBooked).not.toHaveBeenCalled()
    })

    it('does NOT show the picker when an admin is already acting on behalf of someone', async () => {
      setupFromWithChildren([childProfile])
      render(
        <MemoryRouter>
          <RegisterFormBody
            event={sampleEvent}
            profile={sampleProfile}
            userId="diver-99"
            actingOnBehalfOf="diver-99"
            onSubmitSuccess={() => {}}
          />
        </MemoryRouter>
      )
      expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument()
      expect(screen.queryByText(/who is this booking for/i)).not.toBeInTheDocument()
    })
  })
})
