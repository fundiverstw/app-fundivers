import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventCarAssignment } from './EventCarAssignment'
import type { EventVehicle, Vehicle } from '../../types/database'

const {
  fetchVehicles, fetchVehiclesForEvent, fetchRideSeats,
  fetchEventHasTransport, setEventHasTransport, fetchRidePartnerTitles,
} = vi.hoisted(() => ({
  fetchVehicles: vi.fn(),
  fetchVehiclesForEvent: vi.fn(),
  fetchRideSeats: vi.fn(),
  fetchEventHasTransport: vi.fn(),
  setEventHasTransport: vi.fn(),
  fetchRidePartnerTitles: vi.fn(),
}))

vi.mock('../../lib/vehicles', () => ({
  fetchVehicles: (...a: unknown[]) => fetchVehicles(...a),
}))
vi.mock('../../lib/event-vehicles', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchVehiclesForEvent: (...a: unknown[]) => fetchVehiclesForEvent(...a),
  fetchRideSeats: (...a: unknown[]) => fetchRideSeats(...a),
  fetchEventHasTransport: (...a: unknown[]) => fetchEventHasTransport(...a),
  setEventHasTransport: (...a: unknown[]) => setEventHasTransport(...a),
}))
vi.mock('../../lib/ride-groups', () => ({
  fetchRidePartnerTitles: (...a: unknown[]) => fetchRidePartnerTitles(...a),
}))

const van: Vehicle = {
  id: 'v1', name: 'Delica', passenger_seats: 7, active: true, created_at: '', created_by: null,
}
const allocation: EventVehicle = {
  id: 'a1', event_id: 'ev1', vehicle_id: 'v1', created_at: '', created_by: null, notes: null,
}

const event = { id: 'ev1', type: 'course' as const }

beforeEach(() => {
  vi.clearAllMocks()
  fetchVehicles.mockResolvedValue([van])
  fetchVehiclesForEvent.mockResolvedValue([])
  fetchRideSeats.mockResolvedValue({ capacity: 7, claimed: 0, available: 7, seats: 7, staff: 0 })
  fetchEventHasTransport.mockResolvedValue(true)
  setEventHasTransport.mockResolvedValue(undefined)
  fetchRidePartnerTitles.mockResolvedValue([])
})

describe('EventCarAssignment', () => {
  it('offers the car picker while the event carries divers', async () => {
    render(<EventCarAssignment event={event} isAdmin createdBy="admin-1" />)
    expect(await screen.findByRole('group', { name: /assigned cars/i })).toBeInTheDocument()
    expect((screen.getByLabelText(/transport not needed/i) as HTMLInputElement).checked).toBe(false)
  })

  it('switches transport off and withdraws the car picker with it', async () => {
    const user = userEvent.setup()
    render(<EventCarAssignment event={event} isAdmin createdBy="admin-1" />)
    await screen.findByRole('group', { name: /assigned cars/i })

    await user.click(screen.getByLabelText(/transport not needed/i))

    expect(setEventHasTransport).toHaveBeenCalledWith('ev1', false)
    expect(screen.queryByRole('group', { name: /assigned cars/i })).not.toBeInTheDocument()
  })

  it('says so when cars are still assigned to an event that now carries nobody', async () => {
    fetchVehiclesForEvent.mockResolvedValue([allocation])
    fetchEventHasTransport.mockResolvedValue(false)
    render(<EventCarAssignment event={event} isAdmin createdBy="admin-1" />)

    expect(await screen.findByText(/1 car is still assigned/i)).toBeInTheDocument()
    expect(screen.getByText(/carries nobody while this is off/i)).toBeInTheDocument()
  })

  it('warns that divers who already asked for a ride are no longer planned for', async () => {
    fetchEventHasTransport.mockResolvedValue(false)
    fetchRideSeats.mockResolvedValue({ capacity: 7, claimed: 3, available: 4, seats: 7, staff: 0 })
    render(<EventCarAssignment event={event} isAdmin createdBy="admin-1" />)

    expect(await screen.findByText(/3 divers already asked for a ride/i)).toBeInTheDocument()
  })

  it('says nothing about riders when nobody asked for one', async () => {
    fetchEventHasTransport.mockResolvedValue(false)
    fetchRideSeats.mockResolvedValue({ capacity: 0, claimed: 0, available: 0, seats: 0, staff: 0 })
    render(<EventCarAssignment event={event} isAdmin createdBy="admin-1" />)

    await screen.findByLabelText(/transport not needed/i)
    expect(screen.queryByText(/already asked for a ride/i)).not.toBeInTheDocument()
  })

  it('rolls the tick back when the write fails', async () => {
    setEventHasTransport.mockRejectedValue(new Error('denied'))
    const user = userEvent.setup()
    render(<EventCarAssignment event={event} isAdmin createdBy="admin-1" />)
    await screen.findByRole('group', { name: /assigned cars/i })

    await user.click(screen.getByLabelText(/transport not needed/i))

    await waitFor(() =>
      expect(screen.getByText(/could not save that/i)).toBeInTheDocument())
    expect((screen.getByLabelText(/transport not needed/i) as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('group', { name: /assigned cars/i })).toBeInTheDocument()
  })

  it('shows staff the state without a switch to flip', async () => {
    fetchEventHasTransport.mockResolvedValue(false)
    render(<EventCarAssignment event={event} isAdmin={false} createdBy="admin-1" />)

    expect(await screen.findByText(/divers are not asked about a ride/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/transport not needed/i)).not.toBeInTheDocument()
  })
})
