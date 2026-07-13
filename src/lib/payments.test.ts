import { describe, it, expect } from 'vitest'
import { netPaid, netPaidByBooking } from './payments'

describe('netPaid', () => {
  it('sums paid rows and subtracts refunded ones', () => {
    expect(netPaid([
      { status: 'paid', amount: 1000 },
      { status: 'paid', amount: 500 },
      { status: 'refunded', amount: 300 },
    ])).toBe(1200)
  })

  it('ignores pending and voided rows', () => {
    expect(netPaid([
      { status: 'paid', amount: 1000 },
      { status: 'pending', amount: 9999 },
      { status: 'voided', amount: 9999 },
    ])).toBe(1000)
  })

  it('is zero for an empty ledger', () => {
    expect(netPaid([])).toBe(0)
  })

  it('can go negative if refunds exceed recorded payments', () => {
    expect(netPaid([{ status: 'refunded', amount: 500 }])).toBe(-500)
  })
})

describe('netPaidByBooking', () => {
  it('nets per booking and skips null booking_id', () => {
    const m = netPaidByBooking([
      { booking_id: 'b1', status: 'paid', amount: 1000 },
      { booking_id: 'b1', status: 'refunded', amount: 400 },
      { booking_id: 'b2', status: 'paid', amount: 250 },
      { booking_id: null, status: 'paid', amount: 9999 },
    ])
    expect(m.get('b1')).toBe(600)
    expect(m.get('b2')).toBe(250)
    expect(m.size).toBe(2)
  })

  it('omits a booking whose only rows are pending/voided', () => {
    const m = netPaidByBooking([
      { booking_id: 'b1', status: 'pending', amount: 1000 },
    ])
    expect(m.has('b1')).toBe(false)
  })
})
