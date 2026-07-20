import { EVENT_KINDS, type EventKind } from '../types/database'

// Intent helpers for branching on an event's kind.
//
// Almost every kind check in this codebase used to be written as
// `type === 'dive' ? … : …`, where the else-branch silently meant "course".
// That reads fine with two kinds and becomes a trap the moment there is a
// third: a new kind inherits course behaviour everywhere, with no compile
// error and often no visible symptom (an event that is simply never fetched).
//
// Branch on what the code actually cares about instead — the temporal shape,
// whether the shop drives divers there — so a new kind has to answer each
// question explicitly rather than defaulting into someone else's path.

/**
 * True when the event's dates are an envelope (start_date .. end_date) rather
 * than an explicit list of days. Courses run on `course_days`; everything else
 * carries a start and an optional end.
 *
 * This is the single most load-bearing distinction in the codebase: it decides
 * how an event is fetched, expanded into calendar entries, rescheduled, and
 * tested for having passed.
 */
export function usesDateEnvelope(kind: EventKind): boolean {
  return kind !== 'course'
}

/** True when the event runs on an explicit `course_days` list. */
export function usesCourseDays(kind: EventKind): boolean {
  return kind === 'course'
}

// The two temporal groups as value lists, for the queries that have to filter
// by shape. Derived from the helpers rather than written out, so a new kind
// joins the right query the moment it answers `usesDateEnvelope` — the old
// code hardcoded `.eq('kind', 'dive')` / `.eq('kind', 'course')`, which meant
// a third kind would never be fetched at all and would vanish from the
// calendar rather than fail loudly.
export const DATE_ENVELOPE_KINDS: readonly EventKind[] = EVENT_KINDS.filter(usesDateEnvelope)
export const COURSE_DAY_KINDS: readonly EventKind[] = EVENT_KINDS.filter(usesCourseDays)

/**
 * True when the shop may lay on transport, so the register form offers ride
 * seats and the admin gets the car-assignment panel. Courses run at the shop;
 * dives and adventures travel to a site.
 */
export function allowsTransport(kind: EventKind): boolean {
  return kind !== 'course'
}

/**
 * True when the kind carries the dive-specific flags — `is_boat_dive` and
 * `is_trip` (which surfaces the event under Scheduled Trips). Deliberately
 * narrower than `usesDateEnvelope`: these are about diving, not about dates.
 */
export function hasDiveFlags(kind: EventKind): boolean {
  return kind === 'dive'
}
