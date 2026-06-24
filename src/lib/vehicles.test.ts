import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchVehicles, fetchActiveVehicles, saveVehicle, deleteVehicle } from './vehicles'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

// One chainable shared across calls; spies let each test assert what was sent.
const order = vi.fn(() => Promise.resolve({ data: [{ id: 'v1' }], error: null }))
const eqSelect = vi.fn(() => ({ order }))
const select = vi.fn(() => ({ eq: eqSelect, order }))
const insert = vi.fn(() => Promise.resolve({ error: null }))
const updateEq = vi.fn(() => Promise.resolve({ error: null }))
const update = vi.fn(() => ({ eq: updateEq }))
const deleteEq = vi.fn(() => Promise.resolve({ error: null }))
const del = vi.fn(() => ({ eq: deleteEq }))

beforeEach(() => {
  vi.clearAllMocks()
  from.mockReturnValue({ select, insert, update, delete: del })
})

describe('vehicles data layer', () => {
  it('fetchVehicles orders by passenger seats, largest first', async () => {
    const v = await fetchVehicles()
    expect(from).toHaveBeenCalledWith('vehicles')
    expect(order).toHaveBeenCalledWith('passenger_seats', { ascending: false })
    expect(v).toEqual([{ id: 'v1' }])
  })

  it('fetchActiveVehicles filters to active only', async () => {
    await fetchActiveVehicles()
    expect(eqSelect).toHaveBeenCalledWith('active', true)
  })

  it('saveVehicle inserts when there is no id', async () => {
    await saveVehicle({ name: 'Delica', passenger_seats: 7 })
    expect(insert).toHaveBeenCalledWith({ name: 'Delica', passenger_seats: 7 })
    expect(update).not.toHaveBeenCalled()
  })

  it('saveVehicle updates the matching row when given an id', async () => {
    await saveVehicle({ name: 'Delica', passenger_seats: 7 }, 'veh-1')
    expect(update).toHaveBeenCalledWith({ name: 'Delica', passenger_seats: 7 })
    expect(updateEq).toHaveBeenCalledWith('id', 'veh-1')
    expect(insert).not.toHaveBeenCalled()
  })

  it('deleteVehicle removes the matching row', async () => {
    await deleteVehicle('veh-1')
    expect(del).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('id', 'veh-1')
  })
})
