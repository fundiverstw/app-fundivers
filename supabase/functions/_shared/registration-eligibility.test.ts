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

const certed: EligibilityProfileT = { uncertified: false, logged_dives: 30 }
type EligibilityProfileT = { uncertified: boolean | null; logged_dives: number | null }

describe('eligibilityError — certification declaration', () => {
  it('lets a diver who declared no certification at all register', () => {
    expect(eligibilityError({ uncertified: false, logged_dives: 0 }, null, null)).toBeNull()
  })
  it('lets an explicitly uncertified diver register', () => {
    expect(eligibilityError({ uncertified: true, logged_dives: 0 }, null, null)).toBeNull()
  })
  it('has nothing to say about a profile it was given none of', () => {
    expect(eligibilityError(null, null, null)).toBeNull()
  })
})

describe('eligibilityError — event prerequisites', () => {
  it('blocks an uncertified diver from a dive that requires a prereq cert, unless acknowledged', () => {
    const prof = { uncertified: true, logged_dives: 0 }
    const ev = { prereq_cert_id: 'cl-aow', req_dives: null }
    expect(eligibilityError(prof, ev, null)).toMatch(/prerequisite/i)
    expect(eligibilityError(prof, ev, { prereq_acked_at: '2026-07-05T00:00:00Z' })).toBeNull()
  })

  it('blocks when logged dives fall short of req_dives, unless acknowledged', () => {
    const prof = { uncertified: false, logged_dives: 5 }
    const ev = { prereq_cert_id: null, req_dives: 20 }
    expect(eligibilityError(prof, ev, null)).toMatch(/prerequisite/i)
    expect(eligibilityError(prof, ev, { prereq_acked_at: '2026-07-05T00:00:00Z' })).toBeNull()
  })

  it('does not block a certified diver who meets the logged-dive requirement', () => {
    const ev = { prereq_cert_id: 'cl-aow', req_dives: 20 }
    expect(eligibilityError(certed, ev, null)).toBeNull()
  })

  it('only treats an explicit uncertified declaration as a definite cert mismatch', () => {
    // A diver who named a level, or named nothing, is trusted — no rank
    // comparison is attempted against free text, and a blank is not a claim.
    const ev = { prereq_cert_id: 'cl-aow', req_dives: null }
    expect(eligibilityError({ uncertified: false, logged_dives: 30 }, ev, null)).toBeNull()
    expect(eligibilityError({ uncertified: null, logged_dives: 30 }, ev, null)).toBeNull()
  })

  it('treats a blank ack string as unacknowledged', () => {
    const prof = { uncertified: false, logged_dives: 0 }
    const ev = { prereq_cert_id: null, req_dives: 10 }
    expect(eligibilityError(prof, ev, { prereq_acked_at: '' })).not.toBeNull()
  })
})
