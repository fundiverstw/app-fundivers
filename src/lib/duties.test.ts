import { describe, it, expect } from 'vitest'
import { instructorsNeeded } from './duties'

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
