import { describe, it, expect } from 'vitest'
import { computeEffectiveFullPaymentDeadline } from './payment-deadlines'
import type { AppEvent } from '../types/database'

function event(overrides: Partial<AppEvent> = {}): AppEvent {
  return {
    id: 'e1', type: 'dive', title: 't',
    start_time: '2027-05-15T00:00:00.000Z',
    end_time: null, start_time_hhmm: null,
    featured: false, fully_booked: false,
    price: 2000, deposit_amount: 500, currency: 'TWD',
    has_rooms: false, room_type_ids: [],
    has_addons: false, addon_ids: [],
    gear_rental_info: null, nitrox_required: false,
    dive_days: 1, cancelled_at: null,
    full_payment_deadline: null,
    ...overrides,
  }
}

describe('computeEffectiveFullPaymentDeadline', () => {
  it('uses admin-set deadline verbatim when present', () => {
    expect(computeEffectiveFullPaymentDeadline(event({ full_payment_deadline: '2027-05-08' })))
      .toBe('2027-05-08')
  })

  it('falls back to 7 days before start_date when null', () => {
    // start_time = 2027-05-15 → fallback = 2027-05-08
    expect(computeEffectiveFullPaymentDeadline(event())).toBe('2027-05-08')
  })

  it('fallback subtraction handles month/year boundaries', () => {
    expect(computeEffectiveFullPaymentDeadline(event({ start_time: '2027-01-03T00:00:00Z' })))
      .toBe('2026-12-27')
  })
})
