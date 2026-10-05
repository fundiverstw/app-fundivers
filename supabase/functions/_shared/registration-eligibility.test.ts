import { describe, it, expect } from 'vitest'
import { eligibilityError } from './registration-eligibility'

// The rule is src/lib/prereq-shortfall.ts, tested there. This pins the wiring:
// any shortfall refuses, and the nitrox course is read off the booking details.

const LADDER = [
  { id: 'ow',  code: 'open_water',          rank: 1, padi_equivalent_id: 'ow' },
  { id: 'aow', code: 'advanced_open_water', rank: 2, padi_equivalent_id: 'aow' },
]
const ow = { uncertified: false, logged_dives: 30, cert_level_code: 'open_water', nitrox_certified: false }

describe('eligibilityError', () => {
  it('refuses a diver short of the event, whatever the details say', () => {
    const ev = { prereq_cert_id: 'aow', req_dives: null, nitrox_required: false }
    expect(eligibilityError(ow, ev, { prereq_acked_at: '2026-07-05T00:00:00Z' }, LADDER)).toMatch(/prerequisite/i)
  })

  it('lets a diver who meets it through', () => {
    const ev = { prereq_cert_id: 'ow', req_dives: 20, nitrox_required: false }
    expect(eligibilityError(ow, ev, null, LADDER)).toBeNull()
  })

  it('takes the nitrox course in the details as meeting a nitrox requirement', () => {
    const ev = { prereq_cert_id: null, req_dives: null, nitrox_required: true }
    expect(eligibilityError(ow, ev, {}, LADDER)).not.toBeNull()
    expect(eligibilityError(ow, ev, { nitrox_course_addon: true }, LADDER)).toBeNull()
  })

  it('has nothing to say about a registration with no event row', () => {
    expect(eligibilityError(null, null, null, LADDER)).toBeNull()
  })
})
