import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  availableVehicles, allocationEventId, canRequestRide,
  fetchVehicleAllocationsForDate, assignVehicleToEvent, unassignVehicle, fetchRideSeats,
  moveDiveCarAllocations,
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
  id: 'a', created_at: '', created_by: null, vehicle_id: 'v', event_date: '2031-01-01',
  eo_dive_id: null, eo_course_id: null, notes: null, ...over,
})

describe('availableVehicles', () => {
  it('drops cars already allocated that day', () => {
    const fleet = [vehicle('v1', 'Delica'), vehicle('v2', 'Bus'), vehicle('v3', 'Veryca')]
    const taken = new Set(['v2'])
    expect(availableVehicles(fleet, taken).map(v => v.id)).toEqual(['v1', 'v3'])
  })

  it('returns the whole fleet when nothing is allocated', () => {
    const fleet = [vehicle('v1', 'Delica'), vehicle('v2', 'Bus')]
    expect(availableVehicles(fleet, new Set()).map(v => v.id)).toEqual(['v1', 'v2'])
  })

  it('returns empty when every car is taken', () => {
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

describe('fetchVehicleAllocationsForDate', () => {
  it('returns the rows for the date', async () => {
    const rows = [alloc({ id: 'a1', eo_dive_id: 'D1' })]
    from.mockReturnValue(mockQueryBuilder({ data: rows }))
    expect(await fetchVehicleAllocationsForDate('2031-01-01')).toEqual(rows)
  })
  it('surfaces a supabase error', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: { message: 'boom' } }))
    await expect(fetchVehicleAllocationsForDate('2031-01-01')).rejects.toBeTruthy()
  })
})

describe('assignVehicleToEvent', () => {
  it('writes a dive-keyed row (course key null) for a dive event', async () => {
    const builder = mockQueryBuilder({ error: null })
    const insert = vi.fn(() => builder)
    builder.insert = insert
    from.mockReturnValue(builder)

    await assignVehicleToEvent({
      vehicleId: 'v1', date: '2031-01-01',
      event: { id: 'D1', type: 'dive' }, createdBy: 'admin1',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 'v1', event_date: '2031-01-01',
      eo_dive_id: 'D1', eo_course_id: null, created_by: 'admin1',
    }))
  })

  it('writes a course-keyed row (dive key null) for a course event', async () => {
    const builder = mockQueryBuilder({ error: null })
    const insert = vi.fn(() => builder)
    builder.insert = insert
    from.mockReturnValue(builder)

    await assignVehicleToEvent({
      vehicleId: 'v1', date: '2031-01-01',
      event: { id: 'C1', type: 'course' }, createdBy: 'admin1',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      eo_dive_id: null, eo_course_id: 'C1',
    }))
  })

  it('surfaces a supabase error (e.g. the car is already taken)', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: { message: 'duplicate key' } }))
    await expect(assignVehicleToEvent({
      vehicleId: 'v1', date: '2031-01-01',
      event: { id: 'D1', type: 'dive' }, createdBy: 'admin1',
    })).rejects.toBeTruthy()
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

describe('moveDiveCarAllocations', () => {
  // One builder factory drives all three query shapes the function runs:
  // select 'id, vehicle_id' (this dive's rows on the old date), select
  // 'vehicle_id' (cars taken on the new date), and the per-row update/delete.
  function evBuilder(bySelect: (cols: string | undefined) => { data: unknown; error: unknown }) {
    let sel: string | undefined
    const updates: string[] = []
    const deletes: string[] = []
    const b: Record<string, unknown> = {}
    b.select = (cols: string) => { sel = cols; return b }
    b.update = (patch: unknown) => { (b as { _patch?: unknown })._patch = patch; sel = 'update'; return b }
    b.delete = () => { sel = 'delete'; return b }
    b.eq = (col: string, val: string) => {
      if (sel === 'update') updates.push(val)
      if (sel === 'delete') deletes.push(val)
      return b
    }
    b.then = (onF: (r: unknown) => unknown) => Promise.resolve(bySelect(sel)).then(onF)
    return { b, updates, deletes }
  }

  it('is a no-op when the date is unchanged', async () => {
    expect(await moveDiveCarAllocations('D1', '2031-01-01', '2031-01-01')).toEqual({ moved: 0, dropped: 0 })
    expect(from).not.toHaveBeenCalled()
  })

  it('moves free cars and drops cars already taken on the new date', async () => {
    const mine = [{ id: 'a1', vehicle_id: 'v1' }, { id: 'a2', vehicle_id: 'v2' }]
    const taken = [{ vehicle_id: 'v2' }] // v2 is already on another event that day
    const { b } = evBuilder(sel =>
      sel === 'id, vehicle_id' ? { data: mine, error: null }
        : sel === 'vehicle_id' ? { data: taken, error: null }
          : { data: null, error: null })
    from.mockReturnValue(b)

    expect(await moveDiveCarAllocations('D1', '2031-01-01', '2031-02-01')).toEqual({ moved: 1, dropped: 1 })
  })

  it('reports nothing when the dive has no cars on the old date', async () => {
    const { b } = evBuilder(sel =>
      sel === 'id, vehicle_id' ? { data: [], error: null } : { data: [], error: null })
    from.mockReturnValue(b)
    expect(await moveDiveCarAllocations('D1', '2031-01-01', '2031-02-01')).toEqual({ moved: 0, dropped: 0 })
  })
})

describe('canRequestRide', () => {
  it('allows when no cars are assigned yet (capacity 0 = unconfigured)', () => {
    expect(canRequestRide({ capacity: 0, claimed: 5, alreadyHasRide: false })).toBe(true)
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
})
