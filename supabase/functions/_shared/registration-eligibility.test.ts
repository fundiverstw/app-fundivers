import { describe, it, expect } from 'vitest'
import { parseReqDives, eligibilityError } from './registration-eligibility'

describe('parseReqDives', () => {
  it('passes through a finite number', () => {
    expect(parseReqDives(20)).toBe(20)
    expect(parseReqDives(0)).toBe(0)
  })
  it('extracts digits from free text (course rows)', () => {
    expect(parseReqDives('20')).toBe(20)
    expect(parseReqDives('20 dives')).toBe(20)
  })
  it('returns null for empty / non-numeric / nullish', () => {
    expect(parseReqDives('')).toBeNull()
    expect(parseReqDives('none')).toBeNull()
    expect(parseReqDives(null)).toBeNull()
    expect(parseReqDives(undefined)).toBeNull()
  })
})

const certed: EligibilityProfileT = { cert_level: 'AOW', uncertified: false, logged_dives: 30 }
type EligibilityProfileT = { cert_level: string | null; uncertified: boolean | null; logged_dives: number | null }

describe('eligibilityError — certification declaration', () => {
  it('blocks when neither a cert level nor the uncertified flag is set', () => {
    const err = eligibilityError({ cert_level: '', uncertified: false, logged_dives: 0 }, null, null)
    expect(err).toMatch(/certification level|not certified/i)
  })
  it('blocks when cert_level is whitespace only', () => {
    expect(eligibilityError({ cert_level: '   ', uncertified: false, logged_dives: 0 }, null, null)).not.toBeNull()
  })
  it('allows a named cert level', () => {
    expect(eligibilityError(certed, null, null)).toBeNull()
  })
  it('allows an explicit uncertified declaration', () => {
    expect(eligibilityError({ cert_level: null, uncertified: true, logged_dives: 0 }, null, null)).toBeNull()
  })
})

describe('eligibilityError — event prerequisites', () => {
  it('blocks an uncertified diver from a dive that requires a prereq cert, unless acknowledged', () => {
    const prof = { cert_level: null, uncertified: true, logged_dives: 0 }
    const ev = { prereq_cert_id: 'cl-aow', req_dives: null }
    expect(eligibilityError(prof, ev, null)).toMatch(/prerequisite/i)
    expect(eligibilityError(prof, ev, { prereq_acked_at: '2026-07-05T00:00:00Z' })).toBeNull()
  })

  it('blocks when logged dives fall short of req_dives, unless acknowledged', () => {
    const prof = { cert_level: 'OW', uncertified: false, logged_dives: 5 }
    const ev = { prereq_cert_id: null, req_dives: 20 }
    expect(eligibilityError(prof, ev, null)).toMatch(/prerequisite/i)
    expect(eligibilityError(prof, ev, { prereq_acked_at: '2026-07-05T00:00:00Z' })).toBeNull()
  })

  it('does not block a certified diver who meets the logged-dive requirement', () => {
    const ev = { prereq_cert_id: 'cl-aow', req_dives: 20 }
    expect(eligibilityError(certed, ev, null)).toBeNull()
  })

  it('does not rank free-text cert level against the prereq (only uncertified is a definite mismatch)', () => {
    // A named (if low) cert level is trusted — no rank comparison is attempted.
    const prof = { cert_level: 'OW', uncertified: false, logged_dives: 30 }
    const ev = { prereq_cert_id: 'cl-aow', req_dives: null }
    expect(eligibilityError(prof, ev, null)).toBeNull()
  })

  it('treats a blank ack string as unacknowledged', () => {
    const prof = { cert_level: 'OW', uncertified: false, logged_dives: 0 }
    const ev = { prereq_cert_id: null, req_dives: 10 }
    expect(eligibilityError(prof, ev, { prereq_acked_at: '' })).not.toBeNull()
  })
})
