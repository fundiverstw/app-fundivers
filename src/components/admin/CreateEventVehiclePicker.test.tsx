import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateEventVehiclePicker } from './CreateEventVehiclePicker'
import type { Vehicle } from '../../types/database'

const { fetchVehicles } = vi.hoisted(() => ({ fetchVehicles: vi.fn() }))
vi.mock('../../lib/vehicles', () => ({
  fetchVehicles: (...a: unknown[]) => fetchVehicles(...a),
}))

const vehicle = (id: string, name: string, seats: number, active = true): Vehicle => ({
  id, name, passenger_seats: seats, active, created_at: '', created_by: null,
})

beforeEach(() => {
  fetchVehicles.mockReset()
  fetchVehicles.mockResolvedValue([
    vehicle('v1', 'Delica', 7),
    vehicle('v2', 'Bus', 12),
    vehicle('v3', 'Retired', 4, false),
  ])
})

describe('CreateEventVehiclePicker', () => {
  it('lists only active cars and reports the picked ids with a running seat total', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<CreateEventVehiclePicker onChange={onChange} />)

    // Active cars render; the retired one is filtered out.
    expect(await screen.findByText(/Delica \(7 seats\)/)).toBeInTheDocument()
    expect(screen.getByText(/Bus \(12 seats\)/)).toBeInTheDocument()
    expect(screen.queryByText(/Retired/)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/Delica/))
    expect(onChange).toHaveBeenLastCalledWith(['v1'])
    expect(screen.getByText(/7 passenger seats/)).toBeInTheDocument()

    await user.click(screen.getByLabelText(/Bus/))
    expect(onChange).toHaveBeenLastCalledWith(['v1', 'v2'])
    expect(screen.getByText(/19 passenger seats/)).toBeInTheDocument()

    // Toggling one back off drops it from the reported ids.
    await user.click(screen.getByLabelText(/Delica/))
    expect(onChange).toHaveBeenLastCalledWith(['v2'])
  })

  it('shows an empty-fleet note when there are no active cars', async () => {
    fetchVehicles.mockResolvedValue([vehicle('v3', 'Retired', 4, false)])
    render(<CreateEventVehiclePicker onChange={() => {}} />)
    await waitFor(() => expect(screen.getByText(/no active cars in the fleet/i)).toBeInTheDocument())
  })
})
