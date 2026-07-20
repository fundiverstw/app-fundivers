import { describe, it, expect } from 'vitest'
import { depositDue, depositCovered, bookingBalance } from './booking-balance'

describe('depositDue', () => {
  it('is the plain shortfall when no discount is involved', () => {
    expect(depositDue(1000, 3000, 0)).toBe(1000)
    expect(depositDue(1000, 3000, 400)).toBe(600)
    expect(depositDue(1000, 3000, 1000)).toBe(0)
  })

  it('never exceeds what is owed, so a discount cannot strand a deposit', () => {
    // The reported bug: booked at 3000 with a full-value deposit, discounted
    // by 400, diver pays the 2600 they owe. The deposit row demanded 400 more.
    expect(depositDue(3000, 2600, 2600)).toBe(0)
  })

  it('caps an unpaid deposit at the discounted balance', () => {
    // Asking for a 3000 deposit on a 2600 balance is asking for more than the
    // whole booking costs.
    expect(depositDue(3000, 2600, 0)).toBe(2600)
  })

  it('is never negative on an overpayment', () => {
    expect(depositDue(1000, 3000, 5000)).toBe(0)
  })

  it('is zero once the balance is settled, whatever the frozen deposit says', () => {
    // The invariant a diver stated plainly: if the account is settled, nothing
    // should be due. Checked against bookingBalance so the two cannot drift.
    for (const [deposit, owed, paid] of [
      [3000, 2600, 2600], [1000, 1000, 1000], [500, 2600, 2600], [4000, 100, 100],
    ] as const) {
      expect(bookingBalance(owed, paid).state).toBe('settled')
      expect(depositDue(deposit, owed, paid)).toBe(0)
    }
  })

  it('still reports a shortfall while the balance is genuinely unsettled', () => {
    expect(bookingBalance(2600, 1000).state).toBe('due')
    expect(depositDue(3000, 2600, 1000)).toBe(1600)
  })
})

describe('depositCovered', () => {
  it('tracks depositDue exactly', () => {
    expect(depositCovered(1000, 3000, 999)).toBe(false)
    expect(depositCovered(1000, 3000, 1000)).toBe(true)
    expect(depositCovered(3000, 2600, 2600)).toBe(true)
  })
})
