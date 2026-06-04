import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MultiRegisterForm } from './MultiRegisterForm'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { AppEvent, Profile } from '../../types/database'

const { from, invoke } = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => from(...a),
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
  full_name: 'Parent Pat', display_name: 'Pat', phone: null,
  date_of_birth: null, nationality: null, id_number: null,
  emergency_contact_name: null, emergency_contact_phone: null,
  cert_agency: 'PADI', cert_level: 'AOW',
  cert_number: null, cert_date: null, cert_card_path: 'p1/c.jpg',
  nitrox_card_path: null, medical_notes: null,
  avatar_url: null, role: 'diver',
  height_cm: 170, weight_kg: 65, shoe_size: null,
  gender: null, contact_method: null, contact_id: null,
  nitrox_certified: false, logged_dives: 50, last_dive_date: null,
  gear_owned: [],
}

const childProfile: Profile = {
  ...parentProfile, id: 'c1', full_name: 'Kid Junior', display_name: 'KJ',
  cert_level: null, cert_card_path: null,
}

function setupFrom(children: Profile[]) {
  from.mockImplementation((table: string) => {
    if (table === 'profiles') return mockQueryBuilder({ data: children })
    return mockQueryBuilder()
  })
}

beforeEach(() => {
  from.mockReset(); invoke.mockReset()
  invoke.mockResolvedValue({ data: { booking_id: 'b-new', status: 'pending' }, error: null })
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

    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    const bodies = invoke.mock.calls.map(c => (c[1] as { body: Record<string, unknown> }).body)
    const e1Body = bodies.find(b => b.event_id === 'e1')!
    const e2Body = bodies.find(b => b.event_id === 'e2')!

    expect(e1Body.target_user_id).toBe('c1')
    expect(e1Body.profile_patch).toEqual({})
    expect(e2Body.target_user_id).toBeUndefined()
    expect((e2Body.profile_patch as Record<string, unknown>).full_name).toBe('Parent Pat')

    // Both share the same group_id.
    expect(e1Body.group_id).toBe(e2Body.group_id)
    expect(onAll).toHaveBeenCalled()
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
