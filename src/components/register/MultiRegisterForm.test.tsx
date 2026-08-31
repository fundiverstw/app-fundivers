import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MultiRegisterForm } from './MultiRegisterForm'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { AppEvent, Profile } from '../../types/database'
import { t } from '../../i18n'

const { from, invoke, rpc } = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
    rpc: (...a: unknown[]) => rpc(...a),
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}))

const sampleEvent = (id: string, title: string): AppEvent => ({
  id, type: 'dive', title,
  start_time: '2027-05-15T00:00:00.000Z',
  end_time: null, start_time_hhmm: null,
  featured: false, fully_booked: false,
  price: 2800, deposit_amount: null, transport_price: 0, currency: 'TWD',
  has_rooms: false, room_type_ids: [],
  has_addons: false, addon_ids: [],
  gear_rental_info: null, has_transport: true, nitrox_required: false, dive_days: 1,
  cancelled_at: null,
  full_payment_deadline: null,
  cancel_policy: null, cancel_date: null,
})

const parentProfile: Profile = {
  id: 'p1', created_at: '', updated_at: '',
  name: 'Parent Pat', nickname: 'Pat',
  date_of_birth: '1987-05-03', nationality: 'Taiwanese', id_number: null,
  emergency_contact_name: null, emergency_contact_phone: null,
  cert_agency: 'PADI', cert_level: 'AOW',
  cert_number: null, cert_date: null, cert_card_path: 'p1/c.jpg',
  nitrox_card_path: null, medical_notes: null,
  avatar_url: null, role: 'diver',
  height_cm: 170, weight_kg: 65, shoe_size: null,
  gender: 'male', contact_method: null, contact_id: null,
  nitrox_certified: false, logged_dives: 50, last_dive_date: null,
  gear_owned: [],
}

const childProfile: Profile = {
  ...parentProfile, id: 'c1', name: 'Kid Junior', nickname: 'KJ',
  cert_level: null, cert_card_path: null,
}

// The waiver catalog rows the app fetches (was src/config/waivers.ts).
const WAIVER_ROWS = [
  { id: '1', created_at: '', created_by: null, code: 'padi_liability', title: 'Boat Travel & Scuba Diving Liability Release', language: null, body: 'x', pdf_path: null, cadence: 'annual', version: 1, applies_to: 'dives', course_colors: null, active: true },
  { id: '2', created_at: '', created_by: null, code: 'diver_medical', title: 'Diver Medical Questionnaire', language: null, body: 'x', pdf_path: null, cadence: 'annual', version: 1, applies_to: 'none', course_colors: null, active: true },
  { id: '3', created_at: '', created_by: null, code: 'continuing_education', title: 'Continuing Education Liability Release', language: null, body: 'x', pdf_path: null, cadence: 'per_event', version: 1, applies_to: 'courses', course_colors: ['ow', 'aow', 'rescue', 'specialty'], active: true },
]

function setupFrom(children: Profile[]) {
  from.mockImplementation((table: string) => {
    if (table === 'profiles') return mockQueryBuilder({ data: children })
    if (table === 'waivers') return mockQueryBuilder({ data: WAIVER_ROWS })
    if (table === 'payment_methods') return mockQueryBuilder({ data: PAYMENT_METHOD_ROWS })
    return mockQueryBuilder()
  })
}

// The shop's payment methods, read from the DB rather than a hardcoded union.
const PAYMENT_METHOD_ROWS = [
  { key: 'bank_transfer', label: 'Local bank transfer', surcharge_percent: 0, sort_order: 10,
    account_number: '1234-5678-9012' },
  { key: 'credit_card', label: 'Credit card', surcharge_percent: 5, sort_order: 20,
    collects_invoice_email: true },
].map((m, i) => ({
  id: `pm${i}`, created_at: '', created_by: null, blurb: null,
  bank_name: null, bank_branch: null, bank_code: null,
  account_number: null, account_holder: null, swift_bic: null,
  pay_url: null, notes: null,
  collects_invoice_email: false, shows_shop_contact: false, active: true,
  ...m,
}))

beforeEach(() => {
  from.mockReset(); invoke.mockReset(); rpc.mockReset()
  invoke.mockResolvedValue({ data: { booking_id: 'b-new', status: 'pending' }, error: null })
  // Default: no cars assigned (capacity 0) → ride gate fails open everywhere.
  rpc.mockResolvedValue({ data: [{ capacity: 0, claimed: 0 }], error: null })
})

describe('MultiRegisterForm parent diver picker', () => {
  it('hides per-event diver dropdown when the parent has no linked children', async () => {
    setupFrom([])
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    // Wait for children fetch to resolve (would-be picker remains absent).
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    expect(screen.queryByLabelText(/diver for kenting/i)).not.toBeInTheDocument()
  })

  // The name goes onto boat manifests and waiver records, so the multi-event
  // flow has to say which name it wants — it was the one entry point without
  // the passport/ID hint the single-event form and the profile both carry.
  it('asks for the legal name, with the passport / ID hint', async () => {
    setupFrom([])
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await userEvent.setup().click(screen.getByRole('button', { name: /next/i }))  // 1→2

    expect(screen.getByLabelText(/^legal name/i)).toBeInTheDocument()
    expect(screen.getByText(/exactly as it appears on your passport/i)).toBeInTheDocument()
  })

  it('carries an empty step 2 through — no personal detail is required', async () => {
    setupFrom([])
    const blank: Profile = {
      ...parentProfile,
      name: null, date_of_birth: null, nationality: null, gender: null,
      cert_level: null, cert_agency: null, uncertified: false,
    }
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={blank} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))  // 1→2

    expect(screen.getByLabelText(/^legal name/i)).toHaveValue('')
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
    // The cert question can be left unanswered entirely — no scolding.
    expect(screen.queryByText(/certification level/i)).not.toBeInTheDocument()
  })

  it('books an entirely blank profile, sending the blanks as nulls', async () => {
    setupFrom([])
    const blank: Profile = {
      ...parentProfile,
      name: null, date_of_birth: null, nationality: null, gender: null,
      cert_level: null, cert_agency: null, uncertified: false,
    }
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={blank} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))  // 1→2
    await user.click(screen.getByRole('button', { name: /next/i }))  // 2→3
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))  // 3→4
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(invoke).toHaveBeenCalled())
    const body = invoke.mock.calls[0][1].body as Record<string, unknown>
    const patch = body.profile_patch as Record<string, unknown>
    expect(patch.date_of_birth).toBeNull()
    expect(patch.nationality).toBeNull()
    expect(patch.gender).toBeNull()
  })

  it('types the date of birth into a typeable field, not a raw native date input', async () => {
    // The cart flow shares DateField with the solo flow — a native
    // <input type="date"> makes picking a birth year decades back miserable.
    setupFrom([])
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))

    const dobInput = screen.getByLabelText(/date of birth/i)
    expect(dobInput).toHaveAttribute('type', 'text')
    expect(dobInput).toHaveAttribute('placeholder', 'YYYY-MM-DD')
  })

  it('shows per-event diver dropdown including each linked child', async () => {
    setupFrom([childProfile])
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(screen.getByLabelText(/diver for kenting/i)).toBeInTheDocument())
    const opts = screen.getAllByRole('option')
    expect(opts.map(o => o.textContent ?? '').join(' | ')).toMatch(/Myself.*Kid Junior/i)
  })

  it('submitting with a child picked sends target_user_id and empty profile_patch for that call', async () => {
    setupFrom([childProfile])
    const user = userEvent.setup()
    const onAll = vi.fn()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting'), sampleEvent('e2', 'Green Island')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={onAll}
      />
    )
    await waitFor(() => expect(screen.getByLabelText(/diver for kenting/i)).toBeInTheDocument())
    // First event: child. Second event: self.
    await user.selectOptions(screen.getByLabelText(/diver for kenting/i), 'c1')

    // Step 1 → 2: name already pre-filled.
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 2 → 3
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Pick "No" transport on each event (two events, two radio groups).
    const noRadios = screen.getAllByLabelText(/No, I'll get there myself/i)
    expect(noRadios).toHaveLength(2)
    await user.click(noRadios[0])
    await user.click(noRadios[1])
    // Step 3 → 4
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Submit
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    // Two create-registration calls plus one consolidated group summary.
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
    const regCalls = invoke.mock.calls.filter(c => c[0] === 'create-registration')
    expect(regCalls).toHaveLength(2)
    const bodies = regCalls.map(c => (c[1] as { body: Record<string, unknown> }).body)
    const e1Body = bodies.find(b => b.event_id === 'e1')!
    const e2Body = bodies.find(b => b.event_id === 'e2')!

    // Per-diver emails suppressed; one group summary sent for the shared group.
    expect(e1Body.suppress_email).toBe(true)
    expect(e2Body.suppress_email).toBe(true)
    const summaryCall = invoke.mock.calls.find(c => c[0] === 'send-group-summary')!
    expect((summaryCall[1] as { body: { group_id: string } }).body.group_id).toBe(e1Body.group_id)

    expect(e1Body.target_user_id).toBe('c1')
    expect(e1Body.profile_patch).toEqual({})
    expect(e2Body.target_user_id).toBeUndefined()
    expect((e2Body.profile_patch as Record<string, unknown>).name).toBe('Parent Pat')
    // The lead booker's patch carries their DOB, so the server gate passes.
    // The child's stays an empty patch — exempt from that gate, since the cart
    // flow has no field to fill a child's DOB in.
    expect((e2Body.profile_patch as Record<string, unknown>).date_of_birth).toBe('1987-05-03')

    // Both share the same group_id.
    expect(e1Body.group_id).toBe(e2Body.group_id)
    // Default "I'll pay for everyone" is on → every sibling carries the
    // parent as payer.
    expect(e1Body.payer_id).toBe('p1')
    expect(e2Body.payer_id).toBe('p1')
    expect(onAll).toHaveBeenCalled()

    // Each booking carries an itemized charge snapshot that sums to its total.
    for (const body of [e1Body, e2Body]) {
      const details = body.details as { total?: number; charges?: Array<{ kind: string; amount: number }> }
      expect(details.charges?.[0]?.kind).toBe('base')
      expect(details.charges?.reduce((s, c) => s + c.amount, 0)).toBe(details.total)
    }
  })

  it('omits payer_id when the parent unchecks "I\'ll pay for everyone"', async () => {
    setupFrom([childProfile])
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={vi.fn()}
      />
    )
    await waitFor(() => expect(screen.getByLabelText(/diver for kenting/i)).toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText(/diver for kenting/i), 'c1')
    await user.click(screen.getByRole('button', { name: /next/i }))  // 1→2
    await user.click(screen.getByRole('button', { name: /next/i }))  // 2→3
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))  // 3→4

    // Toggle is shown (child is in the cart) and defaults on — turn it off.
    const toggle = screen.getByLabelText(/pay for everyone/i)
    expect(toggle).toBeChecked()
    await user.click(toggle)

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    const body = (invoke.mock.calls[0][1] as { body: Record<string, unknown> }).body
    expect(body.payer_id).toBeUndefined()
  })

  it('offers only the boot style the shop rents when the parent opts into rental', async () => {
    setupFrom([])
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[{ ...sampleEvent('e1', 'Kenting'), gear_rental_info: 'Rentals available on site.' }]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/rent gear/i))

    const box = (item: string) =>
      screen.getByLabelText((text: string) => text.includes(item)) as HTMLInputElement
    expect(box('Boots (felt sole)').checked).toBe(true)
    expect(screen.queryByLabelText((text: string) => text.includes('Boots (rubber sole)'))).toBeNull()
    expect(box('BCD').checked).toBe(true)
    expect(screen.getByText(t.register.gear.ownedOnlyHint)).toBeInTheDocument()
  })

  it('asks for a shoe size when the cart holds a gear-included course', async () => {
    setupFrom([])
    const user = userEvent.setup()
    const dsd: AppEvent = { ...sampleEvent('e1', 'Discover Scuba Diving'), type: 'course' }
    render(
      <MultiRegisterForm
        events={[dsd]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Nothing to rent -- the fee covers it -- but a full set still gets packed.
    expect(screen.getByText(t.register.multi.gearIncluded)).toBeInTheDocument()
    expect(screen.getByText(t.register.gear.sizesTitle)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Shoe size value'), '40')
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    const body = (invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown>; details: { gear: unknown } } }).body
    expect(body.profile_patch.shoe_size).toBe('EU 40 M')
    expect(body.details.gear).toEqual({ rent: false, included: true })
  })

  it('leaves the shoe size unasked when no cart row puts anything on a foot', async () => {
    setupFrom([])
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.queryByText(t.register.gear.sizesTitle)).not.toBeInTheDocument()
  })

  it('saves the height and weight typed on the about-you step', async () => {
    setupFrom([])
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={{ ...parentProfile, height_cm: null, weight_kg: null }} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(screen.getByLabelText(/height \(cm\)/i), '180')
    await user.type(screen.getByLabelText(/weight \(kg\)/i), '78')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    const body = (invoke.mock.calls[0][1] as { body: { profile_patch: Record<string, unknown> } }).body
    expect(body.profile_patch.height_cm).toBe(180)
    expect(body.profile_patch.weight_kg).toBe(78)
  })

  it('shows an itemized price breakdown per event on the payment step', async () => {
    setupFrom([])
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // The summary itemizes the base event fee rather than only the total.
    expect(screen.getByText('Event')).toBeInTheDocument()
    expect(screen.getByText('Grand total')).toBeInTheDocument()
    const fees = screen.getAllByText(/TWD 2,800/)
    expect(fees.length).toBeGreaterThanOrEqual(2)
  })

  it("lists the shop's payment methods and bills the chosen one's own surcharge", async () => {
    setupFrom([])
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('payment_methods'))

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // The first method is preselected and prints the account the shop published.
    expect(screen.getByText(/how to pay — local bank transfer/i)).toBeInTheDocument()
    expect(screen.getByText(/1234-5678-9012/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/invoice email/i)).not.toBeInTheDocument()

    // Switching to the surcharged method adds 5% of 2,800 to the grand total.
    await user.click(screen.getByLabelText(/credit card/i))
    expect(screen.getAllByText(/TWD 2,940/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/invoice email/i)).toBeInTheDocument()
  })

  it('warns the lead booker about their missing waivers on the payment step', async () => {
    setupFrom([]) // waiver_signatures / event_waivers default to empty → annual waivers missing
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText(/waivers to sign before these events/i)).toBeInTheDocument()
    expect(screen.getByText(/boat travel & scuba diving liability release/i)).toBeInTheDocument()
    // Advisory — submit stays enabled.
    expect(screen.getByRole('button', { name: /confirm 1 booking/i })).toBeEnabled()
  })

  it('lets a diver waitlist for a dive\'s ride when its cars are full — selectable with a warning', async () => {
    setupFrom([])
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'event_ride_seats'
        ? { data: [{ capacity: 4, claimed: 4 }], error: null }
        : { data: [], error: null }))
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText(/shop ride is full for this event/i)).toBeInTheDocument()
    const ride = screen.getByLabelText(/yes, ride with the shop/i)
    expect(ride).not.toBeDisabled()
    await user.click(ride)
    expect(screen.getByText(/on the ride waitlist/i)).toBeInTheDocument()
  })

  it('warns on a full car for a course row too, not only a dive', async () => {
    setupFrom([])
    rpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'event_ride_seats'
        ? { data: [{ capacity: 4, claimed: 4 }], error: null }
        : { data: [], error: null }))
    const user = userEvent.setup()
    const owCourse: AppEvent = { ...sampleEvent('e1', 'Open Water Course'), type: 'course' }
    render(
      <MultiRegisterForm
        events={[owCourse]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    expect(await screen.findByText(/shop ride is full for this event/i)).toBeInTheDocument()
    await user.click(screen.getByLabelText(/yes, ride with the shop/i))
    expect(screen.getByText(/on the ride waitlist/i)).toBeInTheDocument()
  })

  it('puts no ride question on a cart row the shop drives nobody to', async () => {
    setupFrom([])
    const user = userEvent.setup()
    const dive: AppEvent = sampleEvent('e1', 'Kenting shore dive')
    const efr: AppEvent = {
      ...sampleEvent('e2', 'Emergency First Response (EFR)'), type: 'course', has_transport: false,
    }
    render(
      <MultiRegisterForm
        events={[dive, efr]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={() => {}}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))

    // One question for the dive, none for the dry course.
    expect(screen.getAllByLabelText(/yes, ride with the shop/i)).toHaveLength(1)
    // Answering the one row that asks is enough to move on.
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
    await user.click(screen.getByLabelText(/no, i'll get there myself/i))
    expect(screen.getByRole('button', { name: /next/i })).not.toBeDisabled()
  })

  it('shows a disabled "Submitting…" state while the booking round-trip is pending', async () => {
    setupFrom([])
    // Hold the booking call open to observe the in-flight button — the gap
    // that previously looked frozen.
    let resolveInvoke!: (v: unknown) => void
    invoke.mockReturnValueOnce(new Promise(res => { resolveInvoke = res }))
    const onAll = vi.fn()
    const user = userEvent.setup()
    render(
      <MultiRegisterForm
        events={[sampleEvent('e1', 'Kenting')]}
        profile={parentProfile} userId="p1"
        onClose={() => {}} onAllBooked={onAll}
      />
    )
    await waitFor(() => expect(from).toHaveBeenCalledWith('profiles'))

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/No, I'll get there myself/i))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    const busy = await screen.findByRole('button', { name: /submitting/i })
    expect(busy).toBeDisabled()

    resolveInvoke({ data: { booking_id: 'b-new', status: 'pending' }, error: null })
    await waitFor(() => expect(onAll).toHaveBeenCalled())
  })
})
