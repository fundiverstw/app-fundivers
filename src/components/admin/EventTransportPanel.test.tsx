import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventTransportPanel, type TransportRegistrant } from './EventTransportPanel'
import { mockQueryBuilder } from '../../../tests/test-utils'
import type { AppEvent, Booking, Profile } from '../../types/database'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

const vehicleRows = [{ id: 'v1', name: 'Delica', passenger_seats: 7, active: true, created_at: '', created_by: null }]
const allocationRows = [
  { id: 'al1', vehicle_id: 'v1', event_date: '2031-05-01', event_id: 'dive_x',
    created_at: '', created_by: null, notes: null },
]

beforeEach(() => {
  from.mockReset()
  from.mockImplementation((table: string) => {
    if (table === 'events') return mockQueryBuilder({ data: { trip_template_id: 'T1', start_date: '2031-05-01' } })
    if (table === 'vehicles') return mockQueryBuilder({ data: vehicleRows })
    if (table === 'event_vehicles') return mockQueryBuilder({ data: allocationRows })
    return mockQueryBuilder({ data: [] }) // bookings update, trip_templates update
  })
})

const event = {
  id: 'dive_x', type: 'dive', currency: 'TWD',
  details: { transportation: 'Meet at the shop at 7am.' },
} as unknown as AppEvent

const booking = (id: string, transportation: boolean | undefined, status = 'confirmed'): Booking => ({
  id, user_id: id, status, event_id: 'dive_x',
  details: transportation === undefined ? {} : { transportation },
} as unknown as Booking)
const profile = (id: string, name: string): Profile => ({ id, name, nickname: name } as unknown as Profile)

const registrants: TransportRegistrant[] = [
  { booking: booking('u1', true),      profile: profile('u1', 'Ada') },
  { booking: booking('u2', false),     profile: profile('u2', 'Bo') },
  { booking: booking('u3', true, 'cancelled'), profile: profile('u3', 'Cancelled Cara') },
]

function renderPanel(over: Partial<React.ComponentProps<typeof EventTransportPanel>> = {}) {
  const onRideChanged = vi.fn()
  render(
    <EventTransportPanel
      event={event}
      registrants={registrants}
      isAdmin
      createdBy="admin-1"
      onRideChanged={onRideChanged}
      {...over}
    />,
  )
  return { onRideChanged }
}

describe('EventTransportPanel (admin)', () => {
  it('shows an editable ride choice per active diver, reflecting current state', () => {
    renderPanel()
    const group = screen.getByRole('group', { name: /ride choices/i })
    const row = (name: string) => within(group).getByText(name).closest('li') as HTMLElement
    expect(within(row('Ada')).getByRole('button', { name: 'Needs ride' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(row('Bo')).getByRole('button', { name: 'Self' })).toHaveAttribute('aria-pressed', 'true')
    // Cancelled diver excluded.
    expect(within(group).queryByText('Cancelled Cara')).not.toBeInTheDocument()
  })

  it('flips a diver and reports the new details up', async () => {
    const { onRideChanged } = renderPanel()
    const group = screen.getByRole('group', { name: /ride choices/i })
    const adaRow = within(group).getByText('Ada').closest('li') as HTMLElement
    await userEvent.click(within(adaRow).getByRole('button', { name: 'Self' }))
    await waitFor(() => expect(onRideChanged).toHaveBeenCalledWith(
      'u1', expect.objectContaining({ transportation: false }),
    ))
  })

  it('shows the editable transport blurb seeded from the event', async () => {
    renderPanel()
    const ta = await screen.findByLabelText('Transport info')
    expect(ta).toHaveValue('Meet at the shop at 7am.')
  })

  it('renders the assigned-cars section for the dive once its date loads', async () => {
    renderPanel()
    const cars = await screen.findByRole('group', { name: /assigned cars/i })
    expect(within(cars).getByText('Delica (7)')).toBeInTheDocument()
  })
})

describe('EventTransportPanel (staff, read-only)', () => {
  it('shows the read-only buckets and no ride-choice buttons', () => {
    renderPanel({ isAdmin: false })
    expect(screen.getByRole('group', { name: /needs ride/i })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /self-transport/i })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /ride choices/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Needs ride' })).not.toBeInTheDocument()
  })

  it('shows the transport blurb as read-only text', () => {
    renderPanel({ isAdmin: false })
    expect(screen.getByText('Meet at the shop at 7am.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Transport info')).not.toBeInTheDocument()
  })
})
