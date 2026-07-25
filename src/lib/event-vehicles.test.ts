import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  availableVehicles, allocationEventId, canRequestRide,
  fetchVehiclesForEvent, fetchVehiclesForEvents,
  assignVehicleToEvent, assignVehiclesToEvent, unassignVehicle, fetchRideSeats,
} from './event-vehicles'
import { supabase } from './supabase'
import type { EventVehicle, Vehicle } from '../types/database'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>
beforeEach(() => { from.mockReset(); rpc.mockReset() })

const vehicle = (id: string, name: string, seats = 7, active = true): Vehicle => ({
  id, name, passenger_seats: seats, active, created_at: '', created_by: null,
})
const alloc = (over: Partial<EventVehicle>): EventVehicle => ({
  id: 'a', created_at: '', created_by: null, vehicle_id: 'v',
  event_id: null, notes: null, ...over,
})

describe('availableVehicles', () => {
  it('drops cars already on this event', () => {
    const fleet = [vehicle('v1', 'Delica'), vehicle('v2', 'Bus'), vehicle('v3', 'Veryca')]
    const assigned = new Set(['v2'])
    expect(availableVehicles(fleet, assigned).map(v => v.id)).toEqual(['v1', 'v3'])
  })

  it('returns the whole fleet when nothing is assigned', () => {
    const fleet = [vehicle('v1', 'Delica'), vehicle('v2', 'Bus')]
    expect(availableVehicles(fleet, new Set()).map(v => v.id)).toEqual(['v1', 'v2'])
  })

  it('returns empty when every car is already on the event', () => {
    const fleet = [vehicle('v1', 'Delica')]
    expect(availableVehicles(fleet, new Set(['v1']))).toEqual([])
  })
})

describe('allocationEventId', () => {
  it('returns the event id for a dive allocation', () => {
    expect(allocationEventId(alloc({ event_id: 'D1' }))).toBe('D1')
  })
  it('returns the event id for a course allocation', () => {
    expect(allocationEventId(alloc({ event_id: 'C1' }))).toBe('C1')
  })
})

describe('fetchVehiclesForEvent', () => {
  it('queries event_vehicles by event id and returns the rows', async () => {
    const rows = [alloc({ id: 'a1', event_id: 'D1' })]
    const b = mockQueryBuilder({ data: rows })
    const eq = vi.fn(() => b); b.eq = eq
    from.mockReturnValue(b)
    expect(await fetchVehiclesForEvent('D1')).toEqual(rows)
    expect(eq).toHaveBeenCalledWith('event_id', 'D1')
  })
  it('queries the same way whatever the event kind', async () => {
    const b = mockQueryBuilder({ data: [] })
    const eq = vi.fn(() => b); b.eq = eq
    from.mockReturnValue(b)
    await fetchVehiclesForEvent('C1')
    expect(eq).toHaveBeenCalledWith('event_id', 'C1')
  })
  it('short-circuits with no event id', async () => {
    expect(await fetchVehiclesForEvent(null)).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
  it('surfaces a supabase error', async () => {
    const b = mockQueryBuilder({ error: { message: 'boom' } })
    b.eq = vi.fn(() => b)
    from.mockReturnValue(b)
    await expect(fetchVehiclesForEvent('D1')).rejects.toBeTruthy()
  })
})

describe('fetchVehiclesForEvents', () => {
  it('gathers allocations for the given events in one query', async () => {
    const rows = [alloc({ id: 'a1', event_id: 'D1' }), alloc({ id: 'a2', event_id: 'C1' })]
    const b = mockQueryBuilder({ data: rows }); const inSpy = vi.fn(() => b); b.in = inSpy
    from.mockReturnValue(b)
    expect(await fetchVehiclesForEvents(['D1', 'C1'])).toEqual(rows)
    expect(inSpy).toHaveBeenCalledWith('event_id', ['D1', 'C1'])
  })
  it('returns empty for an empty id list without querying', async () => {
    expect(await fetchVehiclesForEvents([])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})

describe('assignVehicleToEvent', () => {
  it('writes an event-keyed row for a dive event', async () => {
    const builder = mockQueryBuilder({ error: null })
    const insert = vi.fn(() => builder)
    builder.insert = insert
    from.mockReturnValue(builder)

    await assignVehicleToEvent({
      vehicleId: 'v1', event: { id: 'D1', type: 'dive' }, createdBy: 'admin1',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 'v1', event_id: 'D1', created_by: 'admin1',
    }))
  })

  it('writes an event-keyed row for a course event', async () => {
    const builder = mockQueryBuilder({ error: null })
    const insert = vi.fn(() => builder)
    builder.insert = insert
    from.mockReturnValue(builder)

    await assignVehicleToEvent({
      vehicleId: 'v1', event: { id: 'C1', type: 'course' }, createdBy: 'admin1',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 'v1', event_id: 'C1',
    }))
  })

  it('surfaces a supabase error (e.g. the car is already on the event)', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: { message: 'duplicate key' } }))
    await expect(assignVehicleToEvent({
      vehicleId: 'v1', event: { id: 'D1', type: 'dive' }, createdBy: 'admin1',
    })).rejects.toBeTruthy()
  })
})

describe('assignVehiclesToEvent', () => {
  it('bulk-inserts one row per vehicle', async () => {
    const builder = mockQueryBuilder({ error: null })
    const insert = vi.fn(() => builder)
    builder.insert = insert
    from.mockReturnValue(builder)

    await assignVehiclesToEvent({
      vehicleIds: ['v1', 'v2'], event: { id: 'D1', type: 'dive' }, createdBy: 'admin1',
    })
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ vehicle_id: 'v1', event_id: 'D1' }),
      expect.objectContaining({ vehicle_id: 'v2', event_id: 'D1' }),
    ])
  })
  it('is a no-op for an empty list', async () => {
    await assignVehiclesToEvent({ vehicleIds: [], event: { id: 'D1', type: 'dive' }, createdBy: 'a' })
    expect(from).not.toHaveBeenCalled()
  })
})

describe('unassignVehicle', () => {
  it('surfaces a supabase error', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: { message: 'boom' } }))
    await expect(unassignVehicle('a1')).rejects.toBeTruthy()
  })
})

describe('fetchRideSeats', () => {
  it('derives available from the RPC capacity/claimed', async () => {
    rpc.mockResolvedValue({ data: [{ seats: 9, staff: 2, capacity: 7, claimed: 2 }], error: null })
    expect(await fetchRideSeats('D1')).toEqual({ seats: 9, staff: 2, capacity: 7, claimed: 2, available: 5 })
    expect(rpc).toHaveBeenCalledWith('event_ride_seats', { p_event_id: 'D1' })
  })

  it('never reports negative availability', async () => {
    rpc.mockResolvedValue({ data: [{ seats: 5, staff: 1, capacity: 4, claimed: 9 }], error: null })
    expect(await fetchRideSeats('D1')).toEqual({ seats: 5, staff: 1, capacity: 4, claimed: 9, available: 0 })
  })

  it('treats an empty result as all zeroes', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await fetchRideSeats('C1')).toEqual({ seats: 0, staff: 0, capacity: 0, claimed: 0, available: 0 })
  })

  it('surfaces a supabase error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchRideSeats('D1')).rejects.toBeTruthy()
  })
})

describe('canRequestRide', () => {
  it('allows when no car is assigned yet (capacity 0 = plan the van later)', () => {
    expect(canRequestRide({ capacity: 0, claimed: 0, alreadyHasRide: false })).toBe(true)
  })
  it('allows while a seat is free', () => {
    expect(canRequestRide({ capacity: 7, claimed: 6, alreadyHasRide: false })).toBe(true)
  })
  it('blocks when the assigned cars are full', () => {
    expect(canRequestRide({ capacity: 7, claimed: 7, alreadyHasRide: false })).toBe(false)
  })
  it('lets a diver who already holds a ride keep it even when full', () => {
    expect(canRequestRide({ capacity: 7, claimed: 7, alreadyHasRide: true })).toBe(true)
  })
  it('lets a diver who already holds a ride keep it even if cars were unassigned', () => {
    expect(canRequestRide({ capacity: 0, claimed: 0, alreadyHasRide: true })).toBe(true)
  })
})
