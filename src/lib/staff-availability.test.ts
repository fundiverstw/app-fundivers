import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import {
  fetchStaffAvailabilityInRange, createStaffAvailability,
  updateStaffAvailability, deleteStaffAvailability,
} from './staff-availability'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: { from: vi.fn() },
}))

const from = supabase.from as unknown as ReturnType<typeof vi.fn>

beforeEach(() => from.mockReset())

describe('staff-availability lib', () => {
  it('fetchStaffAvailabilityInRange reads from the view + filters by overlapping range', async () => {
    const rows = [{ id: 'a' }]
    const qb = mockQueryBuilder({ data: rows })
    from.mockReturnValue(qb)
    const lteSpy = vi.spyOn(qb as { lte: () => unknown }, 'lte')
    const gteSpy = vi.spyOn(qb as { gte: () => unknown }, 'gte')

    const result = await fetchStaffAvailabilityInRange('2030-01-01', '2030-01-31')
    expect(from).toHaveBeenCalledWith('staff_availability_view')
    expect(lteSpy).toHaveBeenCalledWith('start_date', '2030-01-31')
    expect(gteSpy).toHaveBeenCalledWith('end_date', '2030-01-01')
    expect(result).toEqual(rows)
  })

  it('createStaffAvailability writes to the table then re-reads the row from the view', async () => {
    const inserted = { id: 'new' }
    const viewed = { id: 'new', user_id: 'u1', title: 'x', owner_display_name: 'Ada' }
    // First call: insert into staff_availability returning just the id.
    // Second call: select from staff_availability_view by id.
    from
      .mockReturnValueOnce(mockQueryBuilder({ data: inserted }))
      .mockReturnValueOnce(mockQueryBuilder({ data: viewed }))

    const result = await createStaffAvailability({
      user_id: 'u1', start_date: '2030-01-01', start_time: '09:00:00',
      end_date: '2030-01-01', title: 'x',
    })
    expect(from).toHaveBeenNthCalledWith(1, 'staff_availability')
    expect(from).toHaveBeenNthCalledWith(2, 'staff_availability_view')
    expect(result).toEqual(viewed)
  })

  it('updateStaffAvailability bubbles up errors from the table write', async () => {
    from.mockReturnValueOnce(mockQueryBuilder({ error: { message: 'nope' } }))
    await expect(updateStaffAvailability('id1', { title: 'y' })).rejects.toMatchObject({ message: 'nope' })
  })

  it('updateStaffAvailability re-reads from the view on success', async () => {
    const viewed = { id: 'id1', title: 'y' }
    from
      .mockReturnValueOnce(mockQueryBuilder({}))                // table update OK
      .mockReturnValueOnce(mockQueryBuilder({ data: viewed }))  // view re-read
    const result = await updateStaffAvailability('id1', { title: 'y' })
    expect(from).toHaveBeenNthCalledWith(1, 'staff_availability')
    expect(from).toHaveBeenNthCalledWith(2, 'staff_availability_view')
    expect(result).toEqual(viewed)
  })

  it('deleteStaffAvailability resolves on success', async () => {
    from.mockReturnValue(mockQueryBuilder({}))
    await expect(deleteStaffAvailability('id1')).resolves.toBeUndefined()
  })
})
