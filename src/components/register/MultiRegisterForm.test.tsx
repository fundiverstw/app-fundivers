import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MultiRegisterForm } from './MultiRegisterForm'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { AppEvent, Profile } from '../../types/database'

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
  gear_rental_info: null, nitrox_required: false, dive_days: 1,
  cancelled_at: null,
  full_payment_deadline: null,
  cancel_policy: null, cancel_date: null,
})

const parentProfile: Profile = {
  id: 'p1', created_at: '', updated_at: '',
  name: 'Parent Pat', nickname: 'Pat',
  date_of_birth: null, nationality: 'Taiwanese', id_number: null,
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

function setupFrom(children: Profile[]) {
  from.mockImplementation((table: string) => {
    if (table === 'profiles') return mockQueryBuilder({ data: children })
    return mockQueryBuilder()
  })
}

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
    expect(screen.getByText(/diver medical questionnaire/i)).toBeInTheDocument()
    // Advisory — submit stays enabled.
    expect(screen.getByRole('button', { name: /confirm 1 booking/i })).toBeEnabled()
  })

  it('disables a dive\'s ride option when its assigned cars are full', async () => {
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

    expect(await screen.findByText(/shop ride is full for this dive/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/yes, ride with the shop/i)).toBeDisabled()
    expect(screen.getByLabelText(/no, i'll get there myself/i)).not.toBeDisabled()
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
