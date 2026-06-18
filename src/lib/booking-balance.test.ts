import { describe, it, expect } from 'vitest'
import { bookingBalance } from './booking-balance'

describe('bookingBalance', () => {
  it('is "due" (red) when the diver still owes money', () => {
    expect(bookingBalance(3200, 1000, 0)).toEqual({ net: 2200, amount: 2200, state: 'due' })
  })

  it('is "settled" when paid plus credit exactly covers what is owed', () => {
    expect(bookingBalance(3200, 3200, 0).state).toBe('settled')
    expect(bookingBalance(3200, 2000, 1200).state).toBe('settled')
  })

  it('is "credit" when an awarded credit puts the diver net ahead', () => {
    expect(bookingBalance(1000, 0, 1500)).toEqual({ net: -500, amount: 500, state: 'credit' })
  })

  it('is "credit" when they paid more than owed (an overpayment is money owed back)', () => {
    // Owed 8,150, paid 8,700, no awarded credit row → 550 credit to the diver.
    expect(bookingBalance(8150, 8700, 0)).toEqual({ net: -550, amount: 550, state: 'credit' })
  })
})
