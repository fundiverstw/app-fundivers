import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RegisterForm, RegisterFormBody } from './RegisterForm'
import { mockQueryBuilder } from '../../../tests/test-utils'
import {
  registrationDraftKey, saveRegistrationDraft, loadRegistrationDraft,
  type RegistrationDraft,
} from '../../lib/registration-draft'
import { GEAR_ITEMS, FULL_GEAR_SET, GEAR_ALACARTE_PRICES } from '../../lib/gear'
import { t } from '../../i18n'
import type { AppEvent, EOAddon, EORoom, Profile } from '../../types/database'

const RUBBER_BOOTS = 'Boots (rubber sole)'
const FELT_BOOTS   = 'Boots (felt sole)'
/** Everything the shop rents except one item — the "owns all but X" fixtures. */
const ownsAllBut = (...except: string[]) => GEAR_ITEMS.filter(i => !except.includes(i))
/** A gear checkbox by item name. Labels carry the price too ("Fins (100)"), and
 *  the boot styles share a prefix, so match on the full name as a substring. */
const gearBox = (item: string) =>
  screen.getByLabelText((text: string) => text.includes(item)) as HTMLInputElement
const queryGearBox = (item: string) =>
  screen.queryByLabelText((text: string) => text.includes(item))

const { from, update, invoke, setSession, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  invoke: vi.fn(),
  setSession: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    rpc: (...a: unknown[]) => rpc(...a),
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
  TurnstileWidget: ({ onToken, onUnavailable }: {
    onToken: (t: string) => void
    onUnavailable?: () => void
  }) => (
    <>
      <button type="button" onClick={() => onToken('test-turnstile-token')}>solve captcha</button>
      <button type="button" onClick={() => onUnavailable?.()}>break captcha</button>
    </>
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
  has_transport: true, nitrox_required: true, dive_days: 1,
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
  gear_rental_info: null, has_transport: true, nitrox_required: false, dive_days: 0,
  cancelled_at: null,
  full_payment_deadline: null,
  cancel_policy: null, cancel_date: null,
}

const sampleProfile: Profile = {
  id: 'u1', created_at: '', updated_at: '',
  name: 'Ada', nickname: 'Ada',
  date_of_birth: '1987-05-03', nationality: 'British', id_number: null,
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
  { id: 'room-a', admin_title: 'kenting_double', display_title: 'Kenting Double', added_price: 1700, currency: 'NTD' },
]
const sampleAddons: EOAddon[] = [
  { id: 'addon-a', admin_title: 'SMB 1 Day', display_title: null, price: 100, currency: 'NTD' },
]

// The waiver catalog rows the app fetches from the `waivers` table (was
// src/config/waivers.ts). event_waivers / waiver_signatures stay empty (default
// builder) so every applicable waiver reads as missing.
const WAIVER_ROWS = [
  { id: '1', created_at: '', created_by: null, code: 'padi_liability', title: 'Boat Travel & Scuba Diving Liability Release', language: null, body: 'x', pdf_path: null, cadence: 'annual', version: 1, applies_to: 'dives', course_colors: null, active: true },
  { id: '2', created_at: '', created_by: null, code: 'diver_medical', title: 'Diver Medical Questionnaire', language: null, body: 'x', pdf_path: null, cadence: 'annual', version: 1, applies_to: 'none', course_colors: null, active: true },
  { id: '3', created_at: '', created_by: null, code: 'continuing_education', title: 'Continuing Education Liability Release', language: null, body: 'x', pdf_path: null, cadence: 'per_event', version: 1, applies_to: 'courses', course_colors: ['ow', 'aow', 'rescue', 'specialty'], active: true },
]

// The shop's payment methods, which the form now reads from the DB instead of
// a hardcoded union. Labels and surcharges are the shop's, so the assertions
// below name these rows rather than catalog strings.
const PAYMENT_METHOD_ROWS = [
  { key: 'bank_transfer', label: 'Local bank transfer', surcharge_percent: 0, sort_order: 10,
    bank_name: 'CTBC Bank', bank_code: '822', account_number: '1234-5678-9012', account_holder: 'The Shop' },
  { key: 'paypal', label: 'PayPal', surcharge_percent: 5, sort_order: 20, pay_url: 'https://paypal.me/example' },
  { key: 'credit_card', label: 'Credit card', surcharge_percent: 5, sort_order: 30, collects_invoice_email: true },
  { key: 'cash', label: 'Cash', surcharge_percent: 0, sort_order: 40, shows_shop_contact: true },
].map((m, i) => ({
  id: `pm${i}`, created_at: '', created_by: null, blurb: null,
  bank_name: null, bank_branch: null, bank_code: null,
  account_number: null, account_holder: null, swift_bic: null,
  pay_url: null, notes: null,
  collects_invoice_email: false, shows_shop_contact: false, active: true,
  ...m,
}))

function setupFrom(updated: unknown = { id: 'b-existing' }) {
  from.mockImplementation((table: string) => {
    if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
    if (table === 'rooms')     return mockQueryBuilder({ data: sampleRooms })
    if (table === 'addons') return mockQueryBuilder({ data: sampleAddons })
    if (table === 'waivers') return mockQueryBuilder({ data: WAIVER_ROWS })
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
  localStorage.clear()
  from.mockReset(); update.mockReset()
  invoke.mockReset(); setSession.mockReset(); rpc.mockReset()
  // Default: the event has assigned cars with free ride seats, so the ride
  // opt-in is offered. Ride-specific tests override this per event_ride_seats.
  rpc.mockImplementation((name: string) =>
    Promise.resolve(name === 'event_ride_seats'
      ? { data: [{ capacity: 7, claimed: 0 }], error: null }
      : { data: 0, error: null }))
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

  it('lets the diver join the ride waitlist when the cars are full — warns and flags the booking', async () => {
    setupFrom()
    // event_ride_seats reports 7 capacity / 7 claimed → no seats left.
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'event_ride_seats'
        ? { data: [{ capacity: 7, claimed: 7 }], error: null }
        : { data: 0, error: null }))
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i })) // step 1 → 2
    await user.click(screen.getByRole('button', { name: /next/i })) // step 2 → 3

    // The ride is full but still selectable; only the message flags it.
    const ride = await screen.findByLabelText(/yes, i'll ride with the shop/i)
    expect(ride).not.toBeDisabled()
    expect(screen.getByText(/the shop ride is full/i)).toBeInTheDocument()

    // Selecting it warns the diver they've joined the ride waitlist.
    await user.click(ride)
    expect(screen.getByText(/added to the ride waitlist/i)).toBeInTheDocument()

    // Completing the booking stamps the ride-waitlist flag on the details.
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))   // step 3 → 4
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const [, opts] = invoke.mock.calls[0] as [string, { body: { details: Record<string, unknown> } }]
    expect(opts.body.details.transportation).toBe(true)
    expect(opts.body.details.ride_waitlisted).toBe(true)
  })

  it('warns a course registrant when the car assigned to the course is full', async () => {
    setupFrom()
    // Cars attach to any event, and the shop drives Open Water students to
    // their shore days. The seat tally used to be skipped for courses, so a
    // full car showed nothing here and the DB trigger waitlisted the diver
    // after the fact.
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'event_ride_seats'
        ? { data: [{ capacity: 7, claimed: 7 }], error: null }
        : { data: 0, error: null }))
    const user = userEvent.setup()
    const owCourse: AppEvent = { ...noExtrasEvent, type: 'course', title: 'Open Water Course' }
    render(
      <RegisterForm event={owCourse} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText(/the shop ride is full/i)).toBeInTheDocument()
    await user.click(screen.getByLabelText(/yes, i'll ride with the shop/i))
    expect(screen.getByText(/added to the ride waitlist/i)).toBeInTheDocument()
  })

  it('puts no ride question on an event the shop drives nobody to', async () => {
    setupFrom()
    // A dry course: EFR, an Equipment specialty, an O2 provider course. The
    // admin ticked "transport not needed" in the vehicle section, so there is
    // nothing to ask and step 3 must not stand there waiting for an answer.
    const efr: AppEvent = {
      ...noExtrasEvent, type: 'course', title: 'Emergency First Response (EFR)', has_transport: false,
    }
    const user = userEvent.setup()
    render(
      <RegisterForm event={efr} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(screen.queryByText(/transportation/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/i'll ride with the shop/i)).not.toBeInTheDocument()
    // Nothing was asked, so nothing blocks the step.
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalled())
    const body = (invoke.mock.calls[0][1] as { body: { details: { transportation: boolean } } }).body
    expect(body.details.transportation).toBe(false)
    // And the seat tally is never asked for — there are no seats to count.
    expect(rpc).not.toHaveBeenCalledWith('event_ride_seats', expect.anything())
  })

  it('shows remaining ride seats when the assigned cars still have room', async () => {
    setupFrom()
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'event_ride_seats'
        ? { data: [{ capacity: 7, claimed: 5 }], error: null }
        : { data: 0, error: null }))
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText(/2 ride seats left/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/yes, i'll ride with the shop/i)).not.toBeDisabled()
  })

  it('warns about missing waivers on step 4 without blocking submit', async () => {
    setupFrom() // event_waivers / waiver_signatures default to empty → all required waivers missing
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

    expect(await screen.findByText(/waivers to sign before this dive/i)).toBeInTheDocument()
    expect(screen.getByText(/boat travel & scuba diving liability release/i)).toBeInTheDocument()
    // Advisory only — the booking can still be confirmed.
    expect(screen.getByRole('button', { name: /confirm booking/i })).toBeEnabled()
  })

  it('opens the e-signature dialog from the step-4 waiver warning', async () => {
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

    await screen.findByText(/waivers to sign before this dive/i)
    await user.click(screen.getAllByRole('button', { name: /sign now/i })[0])
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('offers and applies the diver\'s account credit at checkout for a solo booking', async () => {
    const openCredit = {
      id: 'c1', user_id: 'u1', booking_id: null, amount: 2000, currency: 'TWD',
      reason: 'Cancelled trip', status: 'open', created_by: null,
      created_at: new Date().toISOString(), settled_at: null, settled_note: null,
    }
    from.mockImplementation((table: string) => {
      if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
      if (table === 'rooms')     return mockQueryBuilder({ data: sampleRooms })
      if (table === 'addons') return mockQueryBuilder({ data: sampleAddons })
      if (table === 'credits')      return mockQueryBuilder({ data: [openCredit] })
      return mockQueryBuilder()
    })
    rpc.mockResolvedValue({ data: 2000, error: null })
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

    // Step 4 surfaces the opt-in showing the available credit. It starts
    // unticked — spending credit is the diver's decision, not the form's.
    expect(await screen.findByText(/use my account credit/i)).toBeInTheDocument()
    expect(screen.getByText(/TWD 2,000 available/i)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /use my account credit/i })).not.toBeChecked()
    // Untouched, the diver owes the gross total and no after-credit line shows.
    expect(screen.queryByText(/you'll pay \(after credit\)/i)).not.toBeInTheDocument()

    // Ticking it deducts the credit: 2,800 − 2,000 = 800.
    await user.click(screen.getByRole('checkbox', { name: /use my account credit/i }))
    expect(screen.getByText(/you'll pay \(after credit\)/i)).toBeInTheDocument()
    expect(screen.getByText(/^TWD\s*800$/)).toBeInTheDocument()

    // Unticking restores the gross total and hides the after-credit line again.
    await user.click(screen.getByRole('checkbox', { name: /use my account credit/i }))
    expect(screen.queryByText(/you'll pay \(after credit\)/i)).not.toBeInTheDocument()
    // Re-tick so the confirm path still spends the credit.
    await user.click(screen.getByRole('checkbox', { name: /use my account credit/i }))

    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    // Credit is spent against the freshly-created booking via the RPC.
    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      'apply_credit_to_booking', { p_booking_id: 'b-new', p_amount: 2000 },
    ))

    // The applied credit is also snapshotted onto the booking details so the
    // confirmation PDF can show the gross total (2,800) and the after-credit
    // balance (800). Without this, the emailed PDF would quote the full 2,800.
    const details = (invoke.mock.calls[0][1] as {
      body: { details: { total: number; credit_applied?: number } }
    }).body.details
    expect(details.total).toBe(2800)
    expect(details.credit_applied).toBe(2000)
  })

  it('offers and applies each diver\'s own account credit for a family group', async () => {
    const child: Profile = { ...sampleProfile, id: 'kid1', name: 'Kid', nickname: null, parent_account: 'u1' }
    const openCredit = {
      id: 'c1', user_id: 'u1', booking_id: null, amount: 2000, currency: 'TWD',
      reason: 'Cancelled trip', status: 'open', created_by: null,
      created_at: new Date().toISOString(), settled_at: null, settled_note: null,
    }
    from.mockImplementation((table: string) => {
      if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
      if (table === 'rooms')     return mockQueryBuilder({ data: sampleRooms })
      if (table === 'addons') return mockQueryBuilder({ data: sampleAddons })
      // Every credits read returns an open 2,000 credit, so both the parent
      // (primary) and the child (additional target) have credit to apply.
      if (table === 'credits')      return mockQueryBuilder({ data: [openCredit] })
      if (table === 'profiles')     return mockQueryBuilder({ data: [child] })
      return mockQueryBuilder()
    })
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )

    // Parent + child both selected → group submit. The group now offers to
    // apply each diver's own credit to their own booking.
    await screen.findByText(/who is this booking for/i)
    await user.click(screen.getByLabelText(/kid/i))
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText(/apply each diver.s account credit/i)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /apply each diver.s account credit/i }))

    await user.click(screen.getByRole('button', { name: /confirm/i }))

    // Each booking has its own diver's credit spent against it via the RPC.
    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      'apply_credit_to_booking', expect.objectContaining({ p_amount: 2000 }),
    ))
  })

  it('lets an admin/parent apply the target diver\'s credit when booking on their behalf', async () => {
    const target: Profile = { ...sampleProfile, id: 'diver-99', name: 'Reef Kid', nickname: null }
    const openCredit = {
      id: 'c1', user_id: 'diver-99', booking_id: null, amount: 2000, currency: 'TWD',
      reason: 'Cancelled trip', status: 'open', created_by: null,
      created_at: new Date().toISOString(), settled_at: null, settled_note: null,
    }
    from.mockImplementation((table: string) => {
      if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
      if (table === 'rooms')     return mockQueryBuilder({ data: sampleRooms })
      if (table === 'addons')    return mockQueryBuilder({ data: sampleAddons })
      if (table === 'waivers')   return mockQueryBuilder({ data: WAIVER_ROWS })
      if (table === 'credits')   return mockQueryBuilder({ data: [openCredit] })
      return mockQueryBuilder()
    })
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RegisterFormBody
          event={sampleEvent}
          profile={target}
          userId="admin-1"
          actingOnBehalfOf="diver-99"
          onSubmitSuccess={() => {}}
        />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // The card names the target diver (not "my") and shows their balance.
    expect(await screen.findByText(/apply reef kid.s account credit/i)).toBeInTheDocument()
    expect(screen.getByText(/TWD 2,000 available/i)).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /apply reef kid.s account credit/i }))

    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    // The TARGET diver's credit is spent against the on-behalf booking — the
    // parent/admin caller is authorized by apply_credit_to_booking.
    await waitFor(() => expect(rpc).toHaveBeenCalledWith(
      'apply_credit_to_booking', { p_booking_id: 'b-new', p_amount: 2000 },
    ))
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
      gear_owned: ownsAllBut(),
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
      gear: { rent: boolean; items: string[] }
      add_ons: string[]
      transportation: boolean
      nitrox_course_addon: boolean
      total: number
      charges: Array<{ kind: string; label: string; amount: number }>
    }
    expect(details.gear.rent).toBe(true)
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

  it('asks for a shoe size to rent fins and saves it to the profile, without demanding it', async () => {
    setupFrom()
    const user = userEvent.setup()
    // Owns everything except fins, and has no shoe size on file.
    const profile: Profile = {
      ...sampleProfile,
      shoe_size: null,
      gear_owned: ownsAllBut('Fins'),
    }
    render(<RegisterForm event={sampleEvent} profile={profile} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))

    // Fins is the only un-owned item, so it's pre-checked → the size is asked
    // for. A blank one would book anyway; this diver fills it in.
    expect(await screen.findByText(/we need your sizes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()

    await user.selectOptions(screen.getByLabelText('Shoe size value'), '40')

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const body = invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown> } }
    expect(body.body.profile_patch.shoe_size).toBe('EU 40 M')
  })

  it('asks every diver for height and weight up front, and books without them', async () => {
    setupFrom()
    const user = userEvent.setup()
    const profile: Profile = { ...sampleProfile, height_cm: null, weight_kg: null }
    render(<RegisterForm event={sampleEvent} profile={profile} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Asked on "About you", not behind a gear choice — the wetsuit that has to
    // fit may be one the diver never gets a rental question about.
    await user.type(await screen.findByLabelText(/height \(cm\)/i), '175')
    await user.type(screen.getByLabelText(/weight \(kg\)/i), '70')
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const body = invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown> } }
    expect(body.body.profile_patch.height_cm).toBe(175)
    expect(body.body.profile_patch.weight_kg).toBe(70)
  })

  it('books a diver who leaves height and weight blank', async () => {
    setupFrom()
    const user = userEvent.setup()
    const profile: Profile = { ...sampleProfile, height_cm: null, weight_kg: null }
    render(<RegisterForm event={sampleEvent} profile={profile} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const body = invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown> } }
    expect(body.body.profile_patch.height_cm).toBeNull()
    expect(body.body.profile_patch.weight_kg).toBeNull()
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

  it('Discover Scuba assumes a full rental set, so it asks for a shoe size', async () => {
    setupFrom()
    const user = userEvent.setup()
    const dsd: AppEvent = { ...noExtrasEvent, type: 'course', title: 'Discover Scuba Diving (DSD)' }
    // A try-diver owns nothing and has never given a shoe size.
    const profile: Profile = { ...sampleProfile, shoe_size: null, gear_owned: [] }
    render(
      <RegisterForm event={dsd} profile={profile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // No rental question is asked (the fee covers it) and the size still is,
    // because a full set gets packed either way.
    expect(await screen.findByText(/we'll prepare a full set/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/i need to rent/i)).not.toBeInTheDocument()
    expect(screen.getByText(/we need your sizes/i)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Shoe size value'), '40')
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const body = invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown>; details: { gear: Record<string, unknown> } } }
    expect(body.body.profile_patch.shoe_size).toBe('EU 40 M')
    expect(body.body.details.gear).toEqual({ rent: false, included: true })
  })

  it('leaves the shoe size unasked on a bundled course when the profile has one', async () => {
    setupFrom()
    const user = userEvent.setup()
    const dsd: AppEvent = { ...noExtrasEvent, type: 'course', title: 'Try Dive' }
    render(
      <RegisterForm event={dsd} profile={{ ...sampleProfile, gear_owned: [] }} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(await screen.findByText(/gear is included with this course/i)).toBeInTheDocument()
    expect(screen.queryByText(/we need your sizes/i)).not.toBeInTheDocument()
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
      // The one boot style the shop rents; rubber soles are owned-only.
      expect(gearBox(FELT_BOOTS).checked).toBe(true)
      expect(queryGearBox(RUBBER_BOOTS)).toBeNull()
    })

    // Once the user toggles any item, explicit choice wins (no re-seed on re-render).
    await user.click(screen.getByLabelText(/Wetsuit/i)) // uncheck
    expect((screen.getByLabelText(/Wetsuit/i) as HTMLInputElement).checked).toBe(false)
  })

  it('never offers rubber soles for rental, whatever the diver owns', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: [] }}
        userId="u1" onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))

    await waitFor(() => expect(gearBox(FELT_BOOTS).checked).toBe(true))
    expect(queryGearBox(RUBBER_BOOTS)).toBeNull()
    expect(gearBox('BCD').checked).toBe(true)
  })

  it('tells the diver the list is everything the shop rents', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: [] }}
        userId="u1" onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    expect(await screen.findByText(t.register.gear.ownedOnlyHint)).toBeInTheDocument()
    // Nothing to swap between, so no line about ticking one style clearing another.
    expect(screen.queryByText(t.register.gear.stylesHint)).toBeNull()
  })

  it('books the felt-soled boots the shop actually rents', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: ownsAllBut(RUBBER_BOOTS, FELT_BOOTS) }}
        userId="u1" onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const body = invoke.mock.calls[0][1] as { body: { details: { gear: { items: string[] } } } }
    expect(body.body.details.gear.items).toEqual([FELT_BOOTS])
  })

  it('still asks for a shoe size when the boots being rented are felt-soled', async () => {
    setupFrom()
    const user = userEvent.setup()
    const profile: Profile = {
      ...sampleProfile,
      shoe_size: null,
      gear_owned: ownsAllBut(RUBBER_BOOTS, FELT_BOOTS),
    }
    render(<RegisterForm event={sampleEvent} profile={profile} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))

    expect(await screen.findByText(/we need your sizes/i)).toBeInTheDocument()
  })

  it('leaves boots unticked for a diver who owns rubber ones, who can still add felt', async () => {
    setupFrom()
    const user = userEvent.setup()
    const profile: Profile = {
      ...sampleProfile,
      shoe_size: null,
      gear_owned: ownsAllBut(FELT_BOOTS),
    }
    render(<RegisterForm event={sampleEvent} profile={profile} userId="u1" onClose={() => {}} onBooked={() => {}} />)
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))

    // Owning a pair of boots in any style is a filled slot: nothing pre-ticked.
    await waitFor(() => expect(gearBox(FELT_BOOTS).checked).toBe(false))
    expect(screen.queryByText(/we need your sizes/i)).toBeNull()

    // The grip on a shore entry is a reason to rent felt anyway.
    await user.click(gearBox(FELT_BOOTS))
    expect(gearBox(FELT_BOOTS).checked).toBe(true)
    expect(await screen.findByText(/we need your sizes/i)).toBeInTheDocument()
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

  it('step 2 lets a wholly blank profile through — nothing personal is required', async () => {
    setupFrom()
    const user = userEvent.setup()
    const blankProfile: Profile = {
      ...sampleProfile,
      name: null, date_of_birth: null, nationality: null, gender: null,
      cert_level: null, cert_agency: null, cert_card_path: null, uncertified: false,
    }
    render(
      <RegisterForm event={sampleEvent} profile={blankProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByLabelText(/^legal name/i)).toHaveValue('')
    expect(screen.getByLabelText(/date of birth/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('books an event end to end on a wholly blank profile', async () => {
    setupFrom()
    const user = userEvent.setup()
    const blankProfile: Profile = {
      ...sampleProfile,
      name: null, date_of_birth: null, nationality: null, gender: null,
      cert_level: null, cert_agency: null, cert_card_path: null, uncertified: false,
      shoe_size: null, height_cm: null, weight_kg: null,
    }
    render(
      <RegisterForm event={sampleEvent} profile={blankProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))  // 1 → 2
    await user.click(screen.getByRole('button', { name: /next/i }))  // 2 → 3
    // Transport and gear are decisions about this booking, not facts about the
    // diver — they are still asked, and still the only thing step 3 wants.
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i need to rent/i))
    await user.click(screen.getByRole('button', { name: /next/i }))  // 3 → 4
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const { body } = invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown> } }
    expect(body.profile_patch).toMatchObject({
      name: null, date_of_birth: null, nationality: null, gender: null,
      cert_level: null, shoe_size: null,
    })
  })

  it('drops the required marker from every step-2 label', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    for (const label of [/^legal name/i, /date of birth/i, /nationality/i, /^gender/i]) {
      expect(screen.getByLabelText(label).labels![0].textContent).not.toContain('*')
    }
  })

  it('step 2 defers the cert photo behind the bring-your-card disclaimer', async () => {
    setupFrom()
    const user = userEvent.setup()
    const noCardProfile: Profile = { ...sampleProfile, cert_level: 'Open Water', cert_card_path: null }
    render(
      <RegisterForm event={sampleEvent} profile={noCardProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Cert level named but no card → proof prompt, Next blocked until proof or ack.
    expect(screen.getByText(/add proof of your certification/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    // Ticking the "I'll bring my physical card, no refund" disclaimer releases it.
    await user.click(screen.getByLabelText(/bring my physical certification card/i))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('step 2 takes no answer to the certification question at all', async () => {
    setupFrom()
    const user = userEvent.setup()
    const blankCert: Profile = { ...sampleProfile, cert_level: null, cert_card_path: null }
    render(
      <RegisterForm event={sampleEvent} profile={blankCert} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Neither a level nor the uncertified box, and no card demanded — a blank
    // is not a claim, so there is nothing to prove.
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
    expect(screen.queryByText(/add proof of your certification/i)).not.toBeInTheDocument()

    // Declaring "not certified yet" still hides the cert inputs.
    await user.click(screen.getByLabelText(/not certified yet/i))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
    expect(screen.queryByLabelText(/cert level/i)).not.toBeInTheDocument()
  })

  it('warns and gates on an event logged-dive prerequisite until acknowledged', async () => {
    from.mockImplementation((table: string) => {
      if (table === 'events')     return mockQueryBuilder({ data: { prereq_cert_id: null, req_dives: 20 } })
      if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
      if (table === 'rooms')     return mockQueryBuilder({ data: sampleRooms })
      if (table === 'addons') return mockQueryBuilder({ data: sampleAddons })
      return mockQueryBuilder()
    })
    const user = userEvent.setup()
    // sampleProfile has a cert + card on file (declaration passes) but only 12
    // logged dives — short of the event's 20.
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))  // step 1 → 2
    expect(await screen.findByText(/this event has a prerequisite/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 20 logged dives/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()

    await user.click(screen.getByLabelText(/i understand this requirement/i))
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
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'abcdefgh')
    await user.click(screen.getByLabelText(/I agree to the/i))
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.type(screen.getByLabelText(/^legal name/i), 'Grace Hopper')
    await user.type(screen.getByLabelText(/nationality/i), 'American')
    await user.type(screen.getByLabelText(/date of birth/i), '19061209')
    await user.selectOptions(screen.getByLabelText(/^gender/i), 'female')
    await user.click(screen.getByLabelText(/not certified yet/i))
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
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'abcdefgh')
    await user.click(screen.getByLabelText(/I agree to the/i))
    await user.click(screen.getByRole('button', { name: /solve captcha/i }))
    await user.type(screen.getByLabelText(/^legal name/i), 'Grace Hopper')
    await user.type(screen.getByLabelText(/nationality/i), 'American')
    await user.type(screen.getByLabelText(/date of birth/i), '19061209')
    await user.selectOptions(screen.getByLabelText(/^gender/i), 'female')
    await user.click(screen.getByLabelText(/not certified yet/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    expect(await screen.findByText(/account with that email already exists/i)).toBeInTheDocument()
    expect(screen.getByText(/sign in/i)).toBeInTheDocument()
  })

  it('authed path: recovers a lost-response submit by reading back the landed booking', async () => {
    // The server reports its duplicate-booking guard (HTTP 500 with a message)
    // — as happens when a first attempt landed but its response was lost and
    // the request was retried. The form should confirm via a booking read-back
    // instead of showing a scary error.
    const dedupe = { error: 'This diver already has an active booking for this event (status: pending).' }
    const ctx = new Response(JSON.stringify(dedupe), { status: 500, headers: { 'content-type': 'application/json' } })
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: ctx }),
    })
    from.mockImplementation((table: string) => {
      if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
      if (table === 'rooms')     return mockQueryBuilder({ data: sampleRooms })
      if (table === 'addons') return mockQueryBuilder({ data: sampleAddons })
      if (table === 'bookings')     return mockQueryBuilder({ data: { id: 'b-existing', status: 'pending' } })
      return mockQueryBuilder()
    })
    const onBooked = vi.fn()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))  // 1 → 2
    await user.click(screen.getByRole('button', { name: /next/i }))  // 2 → 3
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))  // 3 → 4
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(onBooked).toHaveBeenCalledWith({ id: 'b-existing', status: 'pending' }))
    expect(screen.queryByText(/already has an active booking/i)).not.toBeInTheDocument()
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
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'abcdefgh')
    await user.click(screen.getByLabelText(/I agree to the/i))
    await user.type(screen.getByLabelText(/^legal name/i), 'Grace Hopper')

    // No captcha widget renders — the notice replaces it and there is no
    // token, so the only way forward is blocked.
    expect(screen.queryByRole('button', { name: /solve captcha/i })).not.toBeInTheDocument()
    expect(screen.getByText(/registration is temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  // Same dead end reached the other way: the key is present but the challenge
  // script never loads (offline, blocking extension, corporate proxy). Without
  // the swap the guest is stuck on step 2 behind a Next button that can never
  // enable, with nothing explaining why.
  it('guest path: when the captcha script cannot load, shows the same unavailable notice', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <RegisterFormBody event={sampleEvent} profile={null} onSubmitSuccess={() => {}} />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(screen.getByLabelText(/email \*/i), 'new@diver.test')
    await user.type(screen.getByLabelText(/password/i, { selector: 'input' }), 'abcdefgh')
    await user.click(screen.getByLabelText(/I agree to the/i))
    await user.type(screen.getByLabelText(/^legal name/i), 'Grace Hopper')

    await user.click(screen.getByRole('button', { name: /break captcha/i }))

    expect(screen.getByText(/registration is temporarily unavailable/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /solve captcha/i })).not.toBeInTheDocument()
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
      id: 'pol-1',
      title: 'Local Multi-day Trip',
      cancellation_policy: 'Deposit non-refundable. 14 days notice for partial refund.',
    }
    from.mockImplementation((table: string) => {
      if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
      if (table === 'rooms')              return mockQueryBuilder({ data: sampleRooms })
      if (table === 'addons')          return mockQueryBuilder({ data: sampleAddons })
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

    // Default = the shop's first method → its published account details.
    expect(screen.getByText(/how to pay — local bank transfer/i)).toBeInTheDocument()
    expect(screen.getByText(/1234-5678-9012/)).toBeInTheDocument()
    expect(screen.getByText(/CTBC Bank/)).toBeInTheDocument()

    // Switch to PayPal → the shop's payment link, and its own surcharge.
    await user.click(screen.getByLabelText(/^paypal/i))
    expect(screen.getByText(/how to pay — paypal \(\+5%\)/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://paypal.me/example' })).toBeInTheDocument()

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

  it('offloads the post-payment reminder off step 4 into a post-submit "What happens next" panel', async () => {
    setupFrom()
    const user = userEvent.setup()
    const onBooked = vi.fn()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked} inlineConfirmation />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // The verbose reminder no longer clutters the payment step…
    expect(screen.queryByText(/after you pay/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/reservation is not confirmed/i)).not.toBeInTheDocument()
    // …but the actionable payment instructions stay (the diver pays from here).
    expect(screen.getByText(/how to pay/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    // After submit: the "What happens next" panel with the spam-folder nudge,
    // and onBooked is deferred until the diver taps Done.
    expect(await screen.findByText(/what happens next/i)).toBeInTheDocument()
    expect(screen.getByText(/spam or junk folder/i)).toBeInTheDocument()
    expect(onBooked).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^done$/i }))
    expect(onBooked).toHaveBeenCalledWith({
      id: expect.any(String), status: 'pending', event_id: sampleEvent.id, user_id: 'u1',
    })
  })

  it('offers "Register for another event" beside Done, handing the booking over the same way', async () => {
    setupFrom()
    const user = userEvent.setup()
    const onBooked = vi.fn()
    const onRegisterAnother = vi.fn()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked} inlineConfirmation
        onRegisterAnother={onRegisterAnother} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await screen.findByText(/what happens next/i)
    await user.click(screen.getByRole('button', { name: /register for another event/i }))

    // The booking still reaches the parent — leaving for the next event is not
    // abandoning this one.
    expect(onRegisterAnother).toHaveBeenCalledWith({
      id: expect.any(String), status: 'pending', event_id: sampleEvent.id, user_id: 'u1',
    })
    expect(onBooked).not.toHaveBeenCalled()
  })

  it('leaves the confirmation panel with Done alone when the caller offers nowhere else to go', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} inlineConfirmation />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await screen.findByText(/what happens next/i)
    expect(screen.queryByRole('button', { name: /register for another event/i })).not.toBeInTheDocument()
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
        gear: { rent: true, items: ['Fins', 'Mask'] },
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

  it('moves past step 2 with no date of birth — the last field that gated every path', async () => {
    setupFrom()
    const user = userEvent.setup()
    const noDob: Profile = { ...sampleProfile, date_of_birth: null }
    render(
      <MemoryRouter>
        <RegisterFormBody
          event={sampleEvent}
          profile={noDob}
          userId="diver-99"
          actingOnBehalfOf="diver-99"
          onSubmitSuccess={() => {}}
        />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()

    // A half-typed date emits nothing upstream, and that is no longer a block.
    await user.type(screen.getByLabelText(/date of birth/i), '1987')
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled()
  })

  it('sends the entered date of birth in the on-behalf-of profile patch', async () => {
    setupFrom()
    const user = userEvent.setup()
    const noDob: Profile = { ...sampleProfile, date_of_birth: null }
    render(
      <MemoryRouter>
        <RegisterFormBody
          event={sampleEvent}
          profile={noDob}
          userId="diver-99"
          actingOnBehalfOf="diver-99"
          onSubmitSuccess={() => {}}
        />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(screen.getByLabelText(/date of birth/i), '19870503')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/no, i don't need a ride/i))
    await user.click(screen.getByLabelText(/i have all the required gear/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalledOnce())
    const opts = invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown> } }
    expect(opts.body.profile_patch).toMatchObject({ date_of_birth: '1987-05-03' })
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
    expect((screen.getByLabelText(/^legal name/i) as HTMLInputElement).value).toBe('')
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
        if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
        if (table === 'rooms')     return mockQueryBuilder({ data: sampleRooms })
        if (table === 'addons') return mockQueryBuilder({ data: sampleAddons })
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
      // Both divers own a full kit, so both bookings cost the same and the
      // summary can honestly call the lead's figure a per-diver price.
      setupFromWithChildren([{ ...childProfile, gear_owned: ownsAllBut() }])
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

    it('prices each diver on their own gear rather than copying the lead', async () => {
      // The parent owns a full kit; the child owns nothing, so the child's
      // question starts on "rent" with every rental slot ticked.
      setupFromWithChildren([{ ...childProfile, gear_owned: [] }])
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: ownsAllBut() }}
          userId="u1" onClose={() => {}} onBooked={() => {}} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
      await user.click(screen.getByLabelText(/i have all the required gear/i))

      // The child gets their own gear question, headed by their name.
      expect(screen.getByText(/gear for bee junior \(bee jr\)/i)).toBeInTheDocument()
      const fullSet = FULL_GEAR_SET.reduce((s, i) => s + (GEAR_ALACARTE_PRICES[i] ?? 0), 0)

      await user.click(screen.getByRole('button', { name: /next/i }))

      // Totals differ, so the summary drops the "per diver" claim and itemizes.
      expect(screen.queryByText('Per diver')).not.toBeInTheDocument()
      const childRow = screen.getByText('Bee Junior (Bee Jr)').closest('div')!
      expect(childRow).toHaveTextContent(`TWD ${(2800 + fullSet).toLocaleString()}`)
      const groupRow = screen.getByText(/group total \(2 divers\)/i).closest('div')!
      expect(groupRow).toHaveTextContent(`TWD ${(2800 + 2800 + fullSet).toLocaleString()}`)

      await user.click(screen.getByRole('button', { name: /confirm booking/i }))
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
      const bodies = invoke.mock.calls
        .filter(c => c[0] === 'create-registration')
        .map(c => (c[1] as { body: Record<string, unknown> }).body)
      const selfBody  = bodies.find(b => !b.target_user_id)!
      const childBody = bodies.find(b => b.target_user_id === 'child-1')!
      const gearOf = (b: Record<string, unknown>) =>
        (b.details as { gear: { rent: boolean; items?: string[] } }).gear
      expect(gearOf(selfBody).rent).toBe(false)
      expect(gearOf(childBody).rent).toBe(true)
      expect(gearOf(childBody).items).toEqual(FULL_GEAR_SET)
      // And the money follows the gear, per booking.
      expect((childBody.details as { total: number }).total).toBe(2800 + fullSet)
      expect((selfBody.details as { total: number }).total).toBe(2800)
    })

    it("asks the lead for a child's shoe size, and patches only that", async () => {
      // The child owns nothing and has no shoe size, so fins are going on feet
      // the shop has no measurement for.
      setupFromWithChildren([{ ...childProfile, gear_owned: [], shoe_size: null }])
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: ownsAllBut() }}
          userId="u1" onClose={() => {}} onBooked={() => {}} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
      await user.click(screen.getByLabelText(/i have all the required gear/i))
      // The lead rents nothing, so the only shoe-size picker is the child's.
      await user.selectOptions(screen.getByLabelText('Shoe size value'), '36')

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /confirm booking/i }))
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
      const bodies = invoke.mock.calls
        .filter(c => c[0] === 'create-registration')
        .map(c => (c[1] as { body: Record<string, unknown> }).body)
      const childBody = bodies.find(b => b.target_user_id === 'child-1')!
      // Only the blank gets filled — nothing else of the lead's form goes near
      // the child's profile.
      expect(childBody.profile_patch).toEqual({ shoe_size: 'EU 36 M' })
    })

    it('asks a size for each child on a course that packs the gear unasked', async () => {
      // No rental question is put on a gear-included course, but a full set is
      // still packed for every diver — including the ones the lead added.
      const dsd: AppEvent = { ...noExtrasEvent, type: 'course', title: 'Discover Scuba Diving (DSD)' }
      setupFromWithChildren([{ ...childProfile, gear_owned: [], shoe_size: null }])
      const user = userEvent.setup()
      render(
        <RegisterForm event={dsd} profile={{ ...sampleProfile, shoe_size: 'EU 42 M' }}
          userId="u1" onClose={() => {}} onBooked={() => {}} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
      // The lead already has a size on file; the child's is the one asked for.
      expect(screen.getByText(/gear for bee junior \(bee jr\)/i)).toBeInTheDocument()
      expect(screen.queryByText(/they have all the required gear/i)).not.toBeInTheDocument()
      await user.selectOptions(screen.getByLabelText('Shoe size value'), '36')

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /confirm booking/i }))
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
      const childBody = invoke.mock.calls
        .filter(c => c[0] === 'create-registration')
        .map(c => (c[1] as { body: Record<string, unknown> }).body)
        .find(b => b.target_user_id === 'child-1')!
      expect(childBody.profile_patch).toEqual({ shoe_size: 'EU 36 M' })
      expect((childBody.details as { gear: { included: boolean } }).gear.included).toBe(true)
    })

    it("leaves a child's profile alone when nothing goes on their feet", async () => {
      setupFromWithChildren([{ ...childProfile, gear_owned: ownsAllBut(), shoe_size: null }])
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: ownsAllBut() }}
          userId="u1" onClose={() => {}} onBooked={() => {}} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
      await user.click(screen.getByLabelText(/i have all the required gear/i))
      expect(screen.queryByLabelText('Shoe size value')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /confirm booking/i }))
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
      const childBody = invoke.mock.calls
        .filter(c => c[0] === 'create-registration')
        .map(c => (c[1] as { body: Record<string, unknown> }).body)
        .find(b => b.target_user_id === 'child-1')!
      expect(childBody.profile_patch).toEqual({})
    })

    it('lets the lead change what an additional diver rents', async () => {
      setupFromWithChildren([{ ...childProfile, gear_owned: [] }])
      const user = userEvent.setup()
      render(
        <RegisterForm event={sampleEvent} profile={{ ...sampleProfile, gear_owned: ownsAllBut() }}
          userId="u1" onClose={() => {}} onBooked={() => {}} />
      )
      await waitFor(() => expect(screen.getByText(/who is this booking for/i)).toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: /bee junior/i }))
      await user.click(screen.getByRole('button', { name: /continue/i }))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByLabelText(/no, i don't need a ride/i))
      await user.click(screen.getByLabelText(/i have all the required gear/i))
      // Only the child's checklist is on the page — the lead rents nothing.
      await user.click(screen.getByLabelText((text: string) => text.includes('Dive computer')))

      await user.click(screen.getByRole('button', { name: /next/i }))
      await user.click(screen.getByRole('button', { name: /confirm booking/i }))
      await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
      const childBody = invoke.mock.calls
        .filter(c => c[0] === 'create-registration')
        .map(c => (c[1] as { body: Record<string, unknown> }).body)
        .find(b => b.target_user_id === 'child-1')!
      const items = (childBody.details as { gear: { items: string[] } }).gear.items
      expect(items).not.toContain('Dive computer')
      expect(items).toContain('BCD')
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

  describe('resume draft', () => {
    function seedDraft(over: Partial<RegistrationDraft> = {}) {
      const key = registrationDraftKey('dive', sampleEvent.id, 'u1')
      const draft: RegistrationDraft = {
        savedAt: Date.now(), step: 2,
        fullName: 'Restored Diver', nickname: '', dob: '', nationality: 'Testland',
        gender: 'other', idNumber: '', contactMethod: 'line', contactId: 'restored-id',
        certAgency: '', certLevel: '', uncertified: false, loggedDives: 7,
        nitroxCertified: false, deepCertified: false,
        emergencyName: '', emergencyPhone: '', guestEmail: '', guestAgreedTerms: false,
        gearChoice: null, gearHelpNote: '', editedGearItems: null,
        shoeSize: '', heightCm: '', weightKg: '',
        roomId: '', roomNotes: '', addonIds: [], needsTransport: null, addNitroxCourse: false,
        payment: 'bank_transfer', creditCardInvoiceEmail: '',
        payForEveryone: true, useAccountCredit: true, payDepositOnly: false, notes: '',
        ...over,
      }
      saveRegistrationDraft(key, draft)
      return key
    }

    it('offers to resume a saved draft and restores the answers on Resume', async () => {
      seedDraft()
      setupFrom()
      const user = userEvent.setup()
      render(
        <MemoryRouter>
          <RegisterFormBody event={sampleEvent} profile={sampleProfile} userId="u1" onSubmitSuccess={() => {}} />
        </MemoryRouter>
      )
      await user.click(await screen.findByRole('button', { name: /^resume$/i }))
      // Draft jumped to step 2 and restored the (draft) full name over the profile value.
      expect(await screen.findByDisplayValue('Restored Diver')).toBeInTheDocument()
    })

    it('clears the draft and hides the banner on Start fresh', async () => {
      const key = seedDraft()
      setupFrom()
      const user = userEvent.setup()
      render(
        <MemoryRouter>
          <RegisterFormBody event={sampleEvent} profile={sampleProfile} userId="u1" onSubmitSuccess={() => {}} />
        </MemoryRouter>
      )
      await user.click(await screen.findByRole('button', { name: /start fresh/i }))
      await waitFor(() => expect(loadRegistrationDraft(key)).toBeNull())
      expect(screen.queryByText(/pick up where you left off/i)).not.toBeInTheDocument()
    })

    it('shows no banner when there is no saved draft', async () => {
      setupFrom()
      render(
        <MemoryRouter>
          <RegisterFormBody event={sampleEvent} profile={sampleProfile} userId="u1" onSubmitSuccess={() => {}} />
        </MemoryRouter>
      )
      await screen.findByText(/step 1 of 4/i)
      expect(screen.queryByText(/pick up where you left off/i)).not.toBeInTheDocument()
    })
  })
})
