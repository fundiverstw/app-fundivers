import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CreateEventVehiclePicker } from './CreateEventVehiclePicker'
import type { Vehicle } from '../../types/database'

const { fetchVehicles, createVehicle } = vi.hoisted(() => ({
  fetchVehicles: vi.fn(),
  createVehicle: vi.fn(),
}))
vi.mock('../../lib/vehicles', () => ({
  fetchVehicles: (...a: unknown[]) => fetchVehicles(...a),
  createVehicle: (...a: unknown[]) => createVehicle(...a),
}))

const vehicle = (id: string, name: string, seats: number, active = true): Vehicle => ({
  id, name, passenger_seats: seats, active, created_at: '', created_by: null,
})

beforeEach(() => {
  fetchVehicles.mockReset()
  createVehicle.mockReset()
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
    render(<CreateEventVehiclePicker onChange={onChange} onTransportChange={() => {}} />)

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

  it('hides the car list and reports no cars once transport is switched off', async () => {
    const onChange = vi.fn()
    const onTransportChange = vi.fn()
    const user = userEvent.setup()
    render(<CreateEventVehiclePicker onChange={onChange} onTransportChange={onTransportChange} />)

    await user.click(await screen.findByLabelText(/Delica/))
    expect(onChange).toHaveBeenLastCalledWith(['v1'])

    await user.click(screen.getByLabelText(/transport not needed/i))
    expect(onTransportChange).toHaveBeenLastCalledWith(false)
    // The picked car is withdrawn along with the question it answered.
    expect(onChange).toHaveBeenLastCalledWith([])
    expect(screen.queryByLabelText(/Delica/)).not.toBeInTheDocument()
    expect(screen.queryByText(/passenger seats/)).not.toBeInTheDocument()

    // Turning it back on restores the picker and the earlier pick.
    await user.click(screen.getByLabelText(/transport not needed/i))
    expect(onTransportChange).toHaveBeenLastCalledWith(true)
    expect(onChange).toHaveBeenLastCalledWith(['v1'])
    expect(screen.getByLabelText(/Delica/)).toBeInTheDocument()
  })

  it('shows an empty-fleet note when there are no active cars', async () => {
    fetchVehicles.mockResolvedValue([vehicle('v3', 'Retired', 4, false)])
    render(<CreateEventVehiclePicker onChange={() => {}} onTransportChange={() => {}} />)
    await waitFor(() => expect(screen.getByText(/no active cars in the fleet/i)).toBeInTheDocument())
  })
})

describe('CreateEventVehiclePicker — adding a car mid-form', () => {
  it('adds it to the fleet and ticks it for this event', async () => {
    createVehicle.mockResolvedValue(vehicle('v9', 'Hired van', 9))
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<CreateEventVehiclePicker onChange={onChange} onTransportChange={() => {}} />)
    await screen.findByText(/Delica \(7 seats\)/)

    await user.click(screen.getByRole('button', { name: /add vehicle/i }))
    await user.type(screen.getByLabelText(/^name$/i), 'Hired van')
    await user.type(screen.getByLabelText(/passenger seats/i), '9')
    await user.click(screen.getByRole('button', { name: /add to fleet/i }))

    await waitFor(() => expect(createVehicle).toHaveBeenCalledWith({
      name: 'Hired van', passenger_seats: 9, active: true,
    }))
    // The car was added FOR this event, so it arrives ticked and counted.
    expect(await screen.findByText(/Hired van \(9 seats\)/)).toBeInTheDocument()
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(['v9']))
    expect(screen.getByText(/9 passenger seats/)).toBeInTheDocument()
    // The form closes behind it.
    expect(screen.queryByRole('button', { name: /add to fleet/i })).not.toBeInTheDocument()
  })

  it('refuses a nameless car and a car with no seats, without writing anything', async () => {
    const user = userEvent.setup()
    render(<CreateEventVehiclePicker onChange={() => {}} onTransportChange={() => {}} />)
    await screen.findByText(/Delica \(7 seats\)/)

    await user.click(screen.getByRole('button', { name: /add vehicle/i }))
    await user.click(screen.getByRole('button', { name: /add to fleet/i }))
    expect(await screen.findByText(/give the vehicle a name/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/^name$/i), 'Nameless')
    await user.click(screen.getByRole('button', { name: /add to fleet/i }))
    expect(await screen.findByText(/at least one passenger seat/i)).toBeInTheDocument()
    expect(createVehicle).not.toHaveBeenCalled()
  })

  it('keeps the typed car on screen when the write fails', async () => {
    createVehicle.mockRejectedValue(new Error('permission denied'))
    const user = userEvent.setup()
    render(<CreateEventVehiclePicker onChange={() => {}} onTransportChange={() => {}} />)
    await screen.findByText(/Delica \(7 seats\)/)

    await user.click(screen.getByRole('button', { name: /add vehicle/i }))
    await user.type(screen.getByLabelText(/^name$/i), 'Hired van')
    await user.type(screen.getByLabelText(/passenger seats/i), '9')
    await user.click(screen.getByRole('button', { name: /add to fleet/i }))

    expect(await screen.findByText(/could not add the vehicle/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Hired van')).toBeInTheDocument()
  })

  it('offers the add form even when the fleet is empty', async () => {
    fetchVehicles.mockResolvedValue([])
    render(<CreateEventVehiclePicker onChange={() => {}} onTransportChange={() => {}} />)
    expect(await screen.findByRole('button', { name: /add vehicle/i })).toBeInTheDocument()
  })
})
