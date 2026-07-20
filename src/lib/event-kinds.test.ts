import { describe, it, expect } from 'vitest'
import {
  EVENT_KINDS,
  usesDateEnvelope, usesCourseDays, allowsTransport, hasDiveFlags, isEventKind,
  DATE_ENVELOPE_KINDS, COURSE_DAY_KINDS, NON_COURSE_KINDS,
} from './event-kinds'

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

  it('gives adventures the dive temporal shape, not the course one', () => {
    // Camping trips run over a start..end envelope like a dive, so they are
    // fetched by the envelope query and rendered from start_date/end_date.
    expect(usesDateEnvelope('adventure')).toBe(true)
    expect(usesCourseDays('adventure')).toBe(false)
  })

  it('offers transport for adventures — the shop drives to the site', () => {
    expect(allowsTransport('adventure')).toBe(true)
  })

  it('does not give adventures the diving-only fields', () => {
    // No boat dives, no nitrox requirement on a camping trip.
    expect(hasDiveFlags('adventure')).toBe(false)
  })

  it('puts adventures in the envelope query group, so the calendar fetches them', () => {
    expect(DATE_ENVELOPE_KINDS).toContain('adventure')
    expect(COURSE_DAY_KINDS).not.toContain('adventure')
    expect(NON_COURSE_KINDS).toContain('adventure')
  })

  it('narrows an untrusted event_type string', () => {
    expect(isEventKind('adventure')).toBe(true)
    expect(isEventKind('dive')).toBe(true)
    expect(isEventKind('camping')).toBe(false)
    expect(isEventKind(null)).toBe(false)
    expect(isEventKind(7)).toBe(false)
  })

  it('keeps the dive-only flags narrower than the date shape', () => {
    // is_boat_dive / is_trip are about diving, so they must not widen along
    // with usesDateEnvelope when a non-dive kind joins it.
    expect(hasDiveFlags('dive')).toBe(true)
    expect(hasDiveFlags('course')).toBe(false)
  })
})
