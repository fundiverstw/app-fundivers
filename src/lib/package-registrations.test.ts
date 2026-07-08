// package-registrations lib: the kickback rollup is the only non-trivial pure
// logic. summarizeKickbacks groups live registrations by currency into
// expected (all) vs paid (kickback_status = paid); cancelled rows and rows
// without an estimate contribute nothing.
import { describe, it, expect } from 'vitest'
import { summarizeKickbacks, type AdminRegistration } from './package-registrations'

const reg = (over: Partial<AdminRegistration>): AdminRegistration => ({
  id: 'x', created_at: '', package_id: 'p', tier_id: 't', diver_id: 'd',
  preferred_start: null, preferred_end: null, estimated_cost: 10000, estimated_currency: 'TWD',
  details: {}, notes: null, status: 'registered', kickback_rate: 0.05, kickback_amount: 500,
  kickback_status: 'expected', paid_at: null, admin_notes: null,
  diver: null, package_title: null, tier_name: null, ...over,
})

describe('summarizeKickbacks', () => {
  it('sums expected across live rows and paid for the paid subset', () => {
    const rows = [
      reg({ kickback_amount: 500, kickback_status: 'expected' }),
      reg({ kickback_amount: 300, kickback_status: 'paid' }),
    ]
    expect(summarizeKickbacks(rows)).toEqual([{ currency: 'TWD', expected: 800, paid: 300 }])
  })

  it('excludes cancelled registrations and rows without a kickback amount', () => {
    const rows = [
      reg({ kickback_amount: 500 }),
      reg({ kickback_amount: 999, status: 'cancelled' }),
      reg({ kickback_amount: null }),
    ]
    expect(summarizeKickbacks(rows)).toEqual([{ currency: 'TWD', expected: 500, paid: 0 }])
  })

  it('groups by currency, sorted', () => {
    const rows = [
      reg({ kickback_amount: 100, estimated_currency: 'USD' }),
      reg({ kickback_amount: 200, estimated_currency: 'TWD', kickback_status: 'paid' }),
    ]
    expect(summarizeKickbacks(rows)).toEqual([
      { currency: 'TWD', expected: 200, paid: 200 },
      { currency: 'USD', expected: 100, paid: 0 },
    ])
  })
})
