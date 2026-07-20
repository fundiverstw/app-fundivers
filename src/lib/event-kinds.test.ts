import { describe, it, expect } from 'vitest'
import { EVENT_KINDS } from '../types/database'
import { usesDateEnvelope, usesCourseDays, allowsTransport, hasDiveFlags } from './event-kinds'

describe('event kind helpers', () => {
  it('splits the temporal shape: courses run on a day list, everything else on an envelope', () => {
    expect(usesCourseDays('course')).toBe(true)
    expect(usesDateEnvelope('course')).toBe(false)
    expect(usesDateEnvelope('dive')).toBe(true)
    expect(usesCourseDays('dive')).toBe(false)
  })

  it('treats the two temporal shapes as exhaustive and mutually exclusive', () => {
    // Every kind must answer this question one way or the other — a kind that
    // is neither would be dropped by the calendar fetch and render nothing.
    for (const kind of EVENT_KINDS) {
      expect(usesDateEnvelope(kind)).toBe(!usesCourseDays(kind))
    }
  })

  it('offers transport for events that travel to a site, not for shop-run courses', () => {
    expect(allowsTransport('dive')).toBe(true)
    expect(allowsTransport('course')).toBe(false)
  })

  it('keeps the dive-only flags narrower than the date shape', () => {
    // is_boat_dive / is_trip are about diving, so they must not widen along
    // with usesDateEnvelope when a non-dive kind joins it.
    expect(hasDiveFlags('dive')).toBe(true)
    expect(hasDiveFlags('course')).toBe(false)
  })
})
