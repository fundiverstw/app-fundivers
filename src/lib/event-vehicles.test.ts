import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  availableVehicles, allocationEventId,
  fetchVehicleAllocationsForDate, assignVehicleToEvent, unassignVehicle,
} from './event-vehicles'
import { supabase } from './supabase'
import type { EventVehicle, Vehicle } from '../types/database'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
beforeEach(() => from.mockReset())

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
