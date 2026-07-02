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
  eo_dive_id: null, eo_course_id: null, notes: null, ...over,
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
  it('returns the dive id for a dive allocation', () => {
    expect(allocationEventId(alloc({ eo_dive_id: 'D1' }))).toBe('D1')
  })
  it('returns the course id for a course allocation', () => {
    expect(allocationEventId(alloc({ eo_course_id: 'C1' }))).toBe('C1')
  })
})

describe('fetchVehiclesForEvent', () => {
  it('queries by the dive key and returns the rows', async () => {
    const rows = [alloc({ id: 'a1', eo_dive_id: 'D1' })]
    const b = mockQueryBuilder({ data: rows })
    const eq = vi.fn(() => b); b.eq = eq
    from.mockReturnValue(b)
    expect(await fetchVehiclesForEvent({ dive_id: 'D1' })).toEqual(rows)
    expect(eq).toHaveBeenCalledWith('eo_dive_id', 'D1')
  })
  it('queries by the course key for a course', async () => {
    const b = mockQueryBuilder({ data: [] })
    const eq = vi.fn(() => b); b.eq = eq
    from.mockReturnValue(b)
    await fetchVehiclesForEvent({ course_id: 'C1' })
    expect(eq).toHaveBeenCalledWith('eo_course_id', 'C1')
  })
  it('short-circuits with no event key', async () => {
    expect(await fetchVehiclesForEvent({})).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
  it('surfaces a supabase error', async () => {
    const b = mockQueryBuilder({ error: { message: 'boom' } })
    b.eq = vi.fn(() => b)
    from.mockReturnValue(b)
    await expect(fetchVehiclesForEvent({ dive_id: 'D1' })).rejects.toBeTruthy()
  })
})

describe('fetchVehiclesForEvents', () => {
  it('gathers dive and course allocations across the day', async () => {
    const diveRows = [alloc({ id: 'a1', eo_dive_id: 'D1' })]
    const courseRows = [alloc({ id: 'a2', eo_course_id: 'C1' })]
    const diveB = mockQueryBuilder({ data: diveRows }); diveB.in = vi.fn(() => diveB)
    const courseB = mockQueryBuilder({ data: courseRows }); courseB.in = vi.fn(() => courseB)
    from.mockReturnValueOnce(diveB).mockReturnValueOnce(courseB)
    expect(await fetchVehiclesForEvents(['D1'], ['C1'])).toEqual([...diveRows, ...courseRows])
  })
  it('skips a query for an empty id list', async () => {
    const b = mockQueryBuilder({ data: [alloc({ eo_dive_id: 'D1' })] }); b.in = vi.fn(() => b)
    from.mockReturnValue(b)
    await fetchVehiclesForEvents(['D1'], [])
    expect(from).toHaveBeenCalledTimes(1)
  })
  it('returns empty when both lists are empty', async () => {
    expect(await fetchVehiclesForEvents([], [])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })
})

describe('assignVehicleToEvent', () => {
  it('writes a dive-keyed row (course key null) for a dive event', async () => {
    const builder = mockQueryBuilder({ error: null })
    const insert = vi.fn(() => builder)
    builder.insert = insert
    from.mockReturnValue(builder)

    await assignVehicleToEvent({
      vehicleId: 'v1', event: { id: 'D1', type: 'dive' }, createdBy: 'admin1',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 'v1', eo_dive_id: 'D1', eo_course_id: null, created_by: 'admin1',
    }))
  })

  it('writes a course-keyed row (dive key null) for a course event', async () => {
    const builder = mockQueryBuilder({ error: null })
    const insert = vi.fn(() => builder)
    builder.insert = insert
    from.mockReturnValue(builder)

    await assignVehicleToEvent({
      vehicleId: 'v1', event: { id: 'C1', type: 'course' }, createdBy: 'admin1',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      eo_dive_id: null, eo_course_id: 'C1',
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
      expect.objectContaining({ vehicle_id: 'v1', eo_dive_id: 'D1', eo_course_id: null }),
      expect.objectContaining({ vehicle_id: 'v2', eo_dive_id: 'D1', eo_course_id: null }),
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
    rpc.mockResolvedValue({ data: [{ capacity: 7, claimed: 2 }], error: null })
    expect(await fetchRideSeats({ dive_id: 'D1' })).toEqual({ capacity: 7, claimed: 2, available: 5 })
    expect(rpc).toHaveBeenCalledWith('event_ride_seats', { p_dive_id: 'D1', p_course_id: null })
  })

  it('never reports negative availability', async () => {
    rpc.mockResolvedValue({ data: [{ capacity: 4, claimed: 9 }], error: null })
    expect(await fetchRideSeats({ dive_id: 'D1' })).toEqual({ capacity: 4, claimed: 9, available: 0 })
  })

  it('treats an empty result as 0/0', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    expect(await fetchRideSeats({ course_id: 'C1' })).toEqual({ capacity: 0, claimed: 0, available: 0 })
  })

  it('surfaces a supabase error', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(fetchRideSeats({ dive_id: 'D1' })).rejects.toBeTruthy()
  })
})

describe('canRequestRide', () => {
  it('blocks when no car is assigned to the event (capacity 0)', () => {
    expect(canRequestRide({ capacity: 0, claimed: 0, alreadyHasRide: false })).toBe(false)
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
