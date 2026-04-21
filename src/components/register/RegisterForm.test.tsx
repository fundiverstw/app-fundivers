import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegisterForm } from './RegisterForm'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { AppEvent, EOAddon, EORoom, Profile } from '../../types/database'

const { from, insert } = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...a: unknown[]) => from(...a) },
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
}

const sampleRooms: EORoom[] = [
  { _id: 'room-a', title: 'kenting_double', display_name: 'Kenting Double', added_price: 1700, currency: 'NTD' },
]
const sampleAddons: EOAddon[] = [
  { _id: 'addon-a', title: 'SMB 1 Day', display_name: null, price: 100, currency: 'NTD' },
]

function setupFrom(inserted: unknown = { id: 'b-new' }) {
  from.mockImplementation((table: string) => {
    if (table === 'EO_rooms')     return mockQueryBuilder({ data: sampleRooms })
    if (table === 'Other_Addons') return mockQueryBuilder({ data: sampleAddons })
    // bookings
    return {
      ...mockQueryBuilder(),
      insert: (...a: unknown[]) => {
        insert(...a)
        return {
          select: () => ({
            single: () => Promise.resolve({ data: inserted, error: null }),
          }),
        }
      },
    }
  })
}

beforeEach(() => { from.mockReset(); insert.mockReset() })

describe('RegisterForm', () => {
  it('walks through 3 steps and submits a minimal booking with empty details structure', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked} />
    )

    // Step 1 → 2
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 2 → 3
    await user.click(screen.getByRole('button', { name: /next/i }))
    // Step 3: confirm
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    const payload = insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      user_id: 'u1',
      eo_dive_id: 'dive_abc',
      eo_course_id: null,
      status: 'pending',
    })
    const details = payload.details as { gear: { rent: boolean }; transportation: boolean; payment_method: string }
    expect(details.gear.rent).toBe(false)
    expect(details.transportation).toBe(false)
    expect(details.payment_method).toBe('bank_transfer')

    await waitFor(() => expect(onBooked).toHaveBeenCalledOnce())
  })

  it('includes gear items and add-ons in the details payload', async () => {
    setupFrom()
    const onBooked = vi.fn()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={onBooked} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Wait for async room/addon fetch to populate the step-2 form
    await screen.findByLabelText(/SMB 1 Day/i)

    // Step 2: turn on gear, pick à-la-carte + Wetsuit
    await user.click(screen.getByLabelText(/rent gear/i))
    const gearSelect = await screen.findByDisplayValue(/full set/i)
    await user.selectOptions(gearSelect, 'a-la-carte')
    await user.click(await screen.findByLabelText(/wetsuit/i))

    // Transport, Nitrox course, one add-on
    await user.click(screen.getByLabelText(/need transportation/i))
    await user.click(screen.getByLabelText(/add nitrox course/i))
    await user.click(screen.getByLabelText(/SMB 1 Day/i))

    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    const payload = insert.mock.calls[0][0] as Record<string, unknown>
    const details = payload.details as {
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
    await user.click(screen.getByRole('button', { name: /next/i }))

    // Step 2 should show "no extras" copy and hide all optional sections
    expect(await screen.findByText(/no extras/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/rent gear/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^room$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^add-ons$/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/add nitrox course/i)).not.toBeInTheDocument()
    // Transportation is always available
    expect(screen.getByLabelText(/need transportation/i)).toBeInTheDocument()
  })

  it('applies a 5% surcharge for credit card payment on the total', async () => {
    setupFrom()
    const user = userEvent.setup()
    render(
      <RegisterForm event={sampleEvent} profile={sampleProfile} userId="u1"
        onClose={() => {}} onBooked={() => {}} />
    )
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByLabelText(/credit card/i))
    await user.click(screen.getByRole('button', { name: /confirm booking/i }))

    await waitFor(() => expect(insert).toHaveBeenCalledOnce())
    const details = (insert.mock.calls[0][0] as Record<string, unknown>).details as { total: number; payment_method: string }
    expect(details.payment_method).toBe('credit_card')
    expect(details.total).toBe(Math.round(2800 * 1.05))
  })
})
