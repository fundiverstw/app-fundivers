import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockQueryBuilder } from '../../tests/test-utils'
import { instructorsNeeded, fetchMyDutyDays } from './duties'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({ supabase: { from: vi.fn() } }))
const from = supabase.from as unknown as ReturnType<typeof vi.fn>
beforeEach(() => from.mockReset())

describe('fetchMyDutyDays', () => {
  it('expands each duty into per-day entries keyed by event id', async () => {
    from.mockReturnValue(mockQueryBuilder({
      data: [
        // Single-day duty (null end_date → same as start_date).
        { eo_dive_id: 'D1', eo_course_id: null, start_date: '2030-01-05', end_date: null },
        // Multi-day duty.
        { eo_dive_id: 'D1', eo_course_id: null, start_date: '2030-01-10', end_date: '2030-01-12' },
        // Course duty.
        { eo_dive_id: null, eo_course_id: 'C1', start_date: '2030-01-08', end_date: '2030-01-08' },
        // No event link → skipped entirely.
        { eo_dive_id: null, eo_course_id: null, start_date: '2030-01-20', end_date: null },
      ],
    }))
    const map = await fetchMyDutyDays('u1', '2030-01-01', '2030-01-31')
    expect(map.get('D1')).toEqual(new Set([
      '2030-01-05', '2030-01-10', '2030-01-11', '2030-01-12',
    ]))
    expect(map.get('C1')).toEqual(new Set(['2030-01-08']))
    expect(map.size).toBe(2)
  })

  it('returns an empty map when there are no matching duties', async () => {
    from.mockReturnValue(mockQueryBuilder({ data: [] }))
    const map = await fetchMyDutyDays('u1', '2030-01-01', '2030-01-31')
    expect(map.size).toBe(0)
  })

  it('surfaces the supabase error', async () => {
    from.mockReturnValue(mockQueryBuilder({ error: { message: 'boom' } }))
    await expect(fetchMyDutyDays('u1', '2030-01-01', '2030-01-31'))
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
    expect(instructorsNeeded([{ role: 'instructor', assignee_id: 'a' }], 5)).toBe(0)
    expect(instructorsNeeded([{ role: 'instructor', assignee_id: 'a' }], 10)).toBe(1)
    expect(instructorsNeeded(
      [{ role: 'instructor', assignee_id: 'a' }, { role: 'instructor', assignee_id: 'b' }],
      10,
    )).toBe(0)
  })

  it('counts distinct instructors — multiple single-day rows for the same person count once', () => {
    // A course instructor on a 3-day course holds 3 single-day duty rows
    // but is still one instructor toward the requirement.
    expect(instructorsNeeded(
      [
        { role: 'instructor', assignee_id: 'a' },
        { role: 'instructor', assignee_id: 'a' },
        { role: 'instructor', assignee_id: 'a' },
      ],
      10,
    )).toBe(1)
  })

  it('does not count guides/support toward the instructor requirement', () => {
    expect(instructorsNeeded(
      [{ role: 'guide', assignee_id: 'a' }, { role: 'support', assignee_id: 'b' }],
      5,
    )).toBe(1)
  })

  it('never returns a negative — extra instructors are fine', () => {
    expect(instructorsNeeded(
      [
        { role: 'instructor', assignee_id: 'a' },
        { role: 'instructor', assignee_id: 'b' },
        { role: 'instructor', assignee_id: 'c' },
      ],
      5,
    )).toBe(0)
  })
})
