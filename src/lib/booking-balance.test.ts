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

  it('a cancelled booking owes nothing regardless of its frozen owed/paid/credit', () => {
    // The event won't happen: the diver owes nothing further, and any money
    // paid is refunded as a separate cancellation credit — so netting here
    // would double-count. Both a positive frozen owed and a paid-in-full
    // booking collapse to a zero, settled balance.
    expect(bookingBalance(4000, 1000, 0, { cancelled: true })).toEqual({ net: 0, amount: 0, state: 'settled' })
    expect(bookingBalance(4000, 1000, 1000, { cancelled: true }).state).toBe('settled')
    expect(bookingBalance(0, 3000, 0, { cancelled: true }).state).toBe('settled')
  })
})
