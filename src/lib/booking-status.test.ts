import { describe, it, expect } from 'vitest'
import { canSelfCancel, isWaitlistPromotion, STATUS_STYLES } from './booking-status'
import type { Booking } from '../types/database'

const STATUSES: Booking['status'][] = ['pending', 'confirmed', 'waitlisted', 'cancelled']

describe('isWaitlistPromotion', () => {
  it('is true only for waitlisted → confirmed', () => {
    expect(isWaitlistPromotion('waitlisted', 'confirmed')).toBe(true)
  })

  it('is false for every other transition into confirmed', () => {
    // pending → confirmed is the diver's own deposit landing; they know.
    expect(isWaitlistPromotion('pending', 'confirmed')).toBe(false)
    expect(isWaitlistPromotion('cancelled', 'confirmed')).toBe(false)
    expect(isWaitlistPromotion('confirmed', 'confirmed')).toBe(false)
  })

  it('is false for every transition out of waitlisted that is not a seat', () => {
    // Being dropped from the waitlist is not good news to email about here.
    expect(isWaitlistPromotion('waitlisted', 'cancelled')).toBe(false)
    expect(isWaitlistPromotion('waitlisted', 'pending')).toBe(false)
    expect(isWaitlistPromotion('waitlisted', 'waitlisted')).toBe(false)
  })

  it('picks out exactly one pair across the whole status matrix', () => {
    // A new status must not quietly start or stop triggering the email.
    const hits = STATUSES.flatMap(from =>
      STATUSES.filter(to => isWaitlistPromotion(from, to)).map(to => `${from}->${to}`))
    expect(hits).toEqual(['waitlisted->confirmed'])
  })
})

describe('STATUS_STYLES', () => {
  it('covers every booking status', () => {
    for (const s of STATUSES) expect(STATUS_STYLES[s]).toBeTruthy()
  })
})


// Money on a booking must never be strandable by a one-tap self-cancel: a
// cancelled booking reads as "settled" everywhere and drops out of the diver's
// account credit, so the amount paid stops showing while the shop still holds
// it. Paid bookings go through Request refund instead. This lived only in
// BookingsPage; CalendarPage's modal cancelled anything, which is how a paid
// diver could strand their own money.
describe('canSelfCancel', () => {
  const pending = { status: 'pending' as const, refund_requested_at: null }

  it('allows cancelling an unpaid pending booking', () => {
    expect(canSelfCancel(pending, 0)).toBe(true)
  })

  it('refuses once any money is on the booking', () => {
    expect(canSelfCancel(pending, 1)).toBe(false)
    expect(canSelfCancel(pending, 3000)).toBe(false)
  })

  it('refuses while a refund request is awaiting a decision', () => {
    expect(canSelfCancel({ ...pending, refund_requested_at: '2026-08-01T00:00:00Z' }, 0)).toBe(false)
  })

  it('refuses for every status other than pending', () => {
    for (const status of STATUSES.filter(s => s !== 'pending')) {
      expect(canSelfCancel({ status, refund_requested_at: null }, 0)).toBe(false)
    }
  })

  it('treats a net-negative paid sum (over-refunded) as nothing paid', () => {
    expect(canSelfCancel(pending, -50)).toBe(true)
  })
})
