import { describe, it, expect } from 'vitest'
import {
  approvedDiscountTotal, discountAmount, discountValueLabel,
  isOpenRequest, offerableDiscounts, sortDiscounts,
} from './discounts'
import type { Discount } from '../types/database'

const discount = (over: Partial<Discount> = {}): Discount => ({
  id: 'd1',
  created_at: '2026-09-01T00:00:00Z',
  created_by: null,
  label: 'Student',
  description: null,
  kind: 'percent',
  value: 10,
  active: true,
  sort_order: 0,
  ...over,
})

describe('discountAmount', () => {
  it('takes a percent of the frozen total', () => {
    expect(discountAmount({ kind: 'percent', value: 10 }, 3000)).toBe(300)
  })

  it('takes a fixed amount whatever the total', () => {
    expect(discountAmount({ kind: 'fixed', value: 500 }, 3000)).toBe(500)
    expect(discountAmount({ kind: 'fixed', value: 500 }, 800)).toBe(500)
  })

  // booking_amendments.amount is an integer, so a percent that lands between
  // units has to resolve to one — and to the same one the RPC picks, or the
  // preview a diver was shown is not the figure the approval writes.
  it('rounds a fractional percent to whole units', () => {
    expect(discountAmount({ kind: 'percent', value: 15 }, 3350)).toBe(503)
  })
})

describe('discountValueLabel', () => {
  it('states a percent as a percent and a fixed amount in the currency', () => {
    expect(discountValueLabel({ kind: 'percent', value: 10 }, 'NTD')).toBe('10%')
    expect(discountValueLabel({ kind: 'fixed', value: 1500 }, 'NTD')).toBe('NTD 1,500')
  })
})

describe('sortDiscounts', () => {
  it('uses the shop order first and the label as the tiebreak', () => {
    const rows = [
      discount({ id: 'c', label: 'Returning', sort_order: 1 }),
      discount({ id: 'b', label: 'Student', sort_order: 0 }),
      discount({ id: 'a', label: 'Member', sort_order: 0 }),
    ]
    expect(sortDiscounts(rows).map(d => d.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('offerableDiscounts', () => {
  const offered = [discount({ id: 'd1' }), discount({ id: 'd2', label: 'Member' })]

  it('offers everything on a booking that has asked for nothing', () => {
    expect(offerableDiscounts(offered, []).map(d => d.id)).toEqual(['d2', 'd1'])
  })

  it('drops one already outstanding or already granted', () => {
    expect(offerableDiscounts(offered, [{ discount_id: 'd1', status: 'requested' }])
      .map(d => d.id)).toEqual(['d2'])
    expect(offerableDiscounts(offered, [{ discount_id: 'd1', status: 'approved' }])
      .map(d => d.id)).toEqual(['d2'])
  })

  // A rejection is usually "you did not show me the card", not "you are not a
  // student" — coming back with it has to be possible.
  it('offers a rejected one again', () => {
    expect(offerableDiscounts(offered, [{ discount_id: 'd1', status: 'rejected' }])
      .map(d => d.id)).toEqual(['d2', 'd1'])
  })
})

describe('approvedDiscountTotal', () => {
  it('counts only what an admin granted', () => {
    expect(approvedDiscountTotal([
      { status: 'approved', amount: 300 },
      { status: 'approved', amount: 200 },
      { status: 'requested', amount: null },
      { status: 'rejected', amount: null },
    ])).toBe(500)
  })
})

describe('isOpenRequest', () => {
  it('is true only while nobody has decided', () => {
    expect(isOpenRequest({ status: 'requested' })).toBe(true)
    expect(isOpenRequest({ status: 'approved' })).toBe(false)
    expect(isOpenRequest({ status: 'rejected' })).toBe(false)
  })
})
