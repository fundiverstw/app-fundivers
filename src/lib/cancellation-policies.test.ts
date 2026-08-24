import { describe, it, expect } from 'vitest'
import { keepsDepositOnCancel } from './cancellation-policies'

// The event form warns an admin that cancelling will keep the deposit. The
// warning has to mean it: the trigger withholds details.deposit, so a
// keep-the-deposit policy on a tier with no deposit amount keeps nothing.
describe('keepsDepositOnCancel', () => {
  const keeps = { deposit_refundable: false }
  const refunds = { deposit_refundable: true }

  it('is true only when a non-refundable policy meets a real deposit', () => {
    expect(keepsDepositOnCancel(keeps, 5000)).toBe(true)
  })

  it('is false when the tier carries no deposit', () => {
    expect(keepsDepositOnCancel(keeps, null)).toBe(false)
    expect(keepsDepositOnCancel(keeps, 0)).toBe(false)
    expect(keepsDepositOnCancel(keeps, undefined)).toBe(false)
  })

  it('is false when the policy refunds the deposit', () => {
    expect(keepsDepositOnCancel(refunds, 5000)).toBe(false)
  })

  it('is false with no policy attached', () => {
    expect(keepsDepositOnCancel(null, 5000)).toBe(false)
    expect(keepsDepositOnCancel(undefined, 5000)).toBe(false)
  })
})
