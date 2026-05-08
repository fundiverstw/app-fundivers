import { describe, it, expect } from 'vitest'
import { formAmount, amendmentsDelta } from './booking-amendments'
import type { BookingAmendment } from '../types/database'

function row(overrides: Partial<BookingAmendment>): BookingAmendment {
  return {
    id: 'a-' + Math.random().toString(36).slice(2, 8),
    booking_id: 'b1',
    amount: 0,
    note: 'note',
    created_by: 'admin1',
    created_at: '2026-05-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('formAmount', () => {
  it('+ → positive amount', () => {
    expect(formAmount('+', 500)).toBe(500)
  })

  it('- → negated amount', () => {
    expect(formAmount('-', 500)).toBe(-500)
  })
})

describe('amendmentsDelta', () => {
  it('empty array → 0', () => {
    expect(amendmentsDelta([])).toBe(0)
  })

  it('sums signed amounts', () => {
    expect(amendmentsDelta([
      row({ amount:  500 }),
      row({ amount: -200 }),
      row({ amount:  100 }),
    ])).toBe(400)
  })

  it('all-negative still sums correctly', () => {
    expect(amendmentsDelta([
      row({ amount: -100 }),
      row({ amount: -250 }),
    ])).toBe(-350)
  })
})
