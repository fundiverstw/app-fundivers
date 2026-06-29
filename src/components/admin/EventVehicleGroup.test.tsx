import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventVehicleGroup } from './EventVehicleGroup'
import type { EventVehicle, Vehicle } from '../../types/database'

const { assignVehicleToEvent, unassignVehicle } = vi.hoisted(() => ({
  assignVehicleToEvent: vi.fn(),
  unassignVehicle: vi.fn(),
}))
vi.mock('../../lib/event-vehicles', () => ({
  assignVehicleToEvent: (...a: unknown[]) => assignVehicleToEvent(...a),
  unassignVehicle: (...a: unknown[]) => unassignVehicle(...a),
}))

beforeEach(() => {
  assignVehicleToEvent.mockReset()
  unassignVehicle.mockReset()
  assignVehicleToEvent.mockResolvedValue(undefined)
  unassignVehicle.mockResolvedValue(undefined)
})

const vehicle = (id: string, name: string, seats: number): Vehicle => ({
  id, name, passenger_seats: seats, active: true, created_at: '', created_by: null,
})
const alloc = (id: string, vehicleId: string): EventVehicle => ({
  id, created_at: '', created_by: null, vehicle_id: vehicleId, event_date: '2031-01-01',
  eo_dive_id: 'D1', eo_course_id: null, notes: null,
})

const delica = vehicle('v1', 'Delica', 7)
const bus = vehicle('v2', 'Bus', 12)

function setup(over: Partial<React.ComponentProps<typeof EventVehicleGroup>> = {}) {
  const onChanged = vi.fn()
  render(
    <EventVehicleGroup
      event={{ id: 'D1', type: 'dive' }}
      dayKey="2031-01-01"
      allocations={[]}
      available={[delica, bus]}
      vehicleMap={new Map([[delica.id, delica], [bus.id, bus]])}
      riders={5}
      isAdmin={true}
      createdBy="admin-1"
      onChanged={onChanged}
      {...over}
    />,
  )
  return { onChanged }
}

describe('EventVehicleGroup', () => {
  it('shows assigned cars with their seat totals', () => {
    // An allocated car drops out of `available` (the parent computes that).
    setup({ allocations: [alloc('a1', 'v1')], available: [bus] })
    expect(screen.getByText('Delica (7)')).toBeInTheDocument()
    // 7 assigned seats · 5 to transport
    expect(screen.getByText(/7 seats · 5 to transport/)).toBeInTheDocument()
  })

  it('lets an admin assign an available car', async () => {
    const { onChanged } = setup()
    await userEvent.selectOptions(screen.getByLabelText('Assign a car'), 'v2')
    await waitFor(() => expect(assignVehicleToEvent).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleId: 'v2', date: '2031-01-01', createdBy: 'admin-1' }),
    ))
    expect(onChanged).toHaveBeenCalled()
  })

  it('lets an admin unassign an assigned car', async () => {
    const { onChanged } = setup({ allocations: [alloc('a1', 'v1')], available: [bus] })
    await userEvent.click(screen.getByLabelText('Unassign Delica'))
    await waitFor(() => expect(unassignVehicle).toHaveBeenCalledWith('a1'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('warns when no cars are free that day', () => {
    setup({ available: [] })
    expect(screen.getByText(/No cars free/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Assign a car')).not.toBeInTheDocument()
  })

  it('for staff (read-only) shows chips but no assign or unassign controls', () => {
    setup({ isAdmin: false, allocations: [alloc('a1', 'v1')] })
    expect(screen.getByText('Delica (7)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Assign a car')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Unassign Delica')).not.toBeInTheDocument()
  })

  it('renders nothing for staff when no cars are assigned', () => {
    const { container } = render(
      <EventVehicleGroup
        event={{ id: 'D1', type: 'dive' }}
        dayKey="2031-01-01"
        allocations={[]}
        available={[delica]}
        vehicleMap={new Map([[delica.id, delica]])}
        riders={0}
        isAdmin={false}
        createdBy={null}
        onChanged={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
