import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import { instructorsNeeded, fetchMyDutyEventIds } from './duties'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
beforeEach(() => from.mockReset())

describe('fetchMyDutyEventIds', () => {
  it('returns a Set of distinct eo_dive_id + eo_course_id values from the rows', async () => {
    from.mockReturnValue(mockQueryBuilder({
      data: [
        { eo_dive_id: 'D1', eo_course_id: null },
        { eo_dive_id: 'D1', eo_course_id: null }, // duplicate → still one entry
        { eo_dive_id: null, eo_course_id: 'C1' },
        { eo_dive_id: null, eo_course_id: null }, // no event link → skipped
      ],
    }))
    const ids = await fetchMyDutyEventIds('u1', '2030-01-01', '2030-01-31')
    expect(ids).toEqual(new Set(['D1', 'C1']))
  })

  it('returns an empty Set when there are no matching duties', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    const ids = await fetchMyDutyEventIds('u1', '2030-01-01', '2030-01-31')
    expect(ids.size).toBe(0)
  })

  it('surfaces the supabase error', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: { message: 'boom' } }))
    await expect(fetchMyDutyEventIds('u1', '2030-01-01', '2030-01-31'))
      .rejects.toMatchObject({ message: 'boom' })
  })
})

describe('instructorsNeeded', () => {
  it('returns 0 when nobody is registered', () => {
    expect(instructorsNeeded([], 0)).toBe(0)
  })

  it('requires 1 instructor per group of 5 (ceiling)', () => {
    expect(instructorsNeeded([], 1)).toBe(1)  // 1 diver → 1 instructor
    expect(instructorsNeeded([], 5)).toBe(1)  // 5 divers → 1 instructor
    expect(instructorsNeeded([], 6)).toBe(2)  // 6 divers → 2 instructors
    expect(instructorsNeeded([], 11)).toBe(3) // 11 divers → 3 instructors
  })

  it('subtracts already-assigned instructors', () => {
    expect(instructorsNeeded([{ role: 'instructor' }], 5)).toBe(0)
    expect(instructorsNeeded([{ role: 'instructor' }], 10)).toBe(1)
    expect(instructorsNeeded([{ role: 'instructor' }, { role: 'instructor' }], 10)).toBe(0)
  })

  it('does not count guides/support toward the instructor requirement', () => {
    expect(instructorsNeeded(
      [{ role: 'guide' }, { role: 'support' }],
      5,
    )).toBe(1)
  })

  it('never returns a negative — extra instructors are fine', () => {
    expect(instructorsNeeded(
      [{ role: 'instructor' }, { role: 'instructor' }, { role: 'instructor' }],
      5,
    )).toBe(0)
  })
})
