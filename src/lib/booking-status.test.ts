import { describe, it, expect } from 'vitest'
import { isWaitlistPromotion, STATUS_STYLES } from './booking-status'
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
