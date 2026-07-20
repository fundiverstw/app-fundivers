// The event-kind vocabulary and the questions the code asks about it.
//
// Deliberately import-free: the Deno edge functions and the push worker both
// need this vocabulary, and neither can load a module that reaches into the
// app's config or i18n. Anything needing a translated label lives in
// event-kind-labels.ts instead. src/types/database.ts carries a compile-time
// guard that this list covers the generated `events.kind` union, so the two
// cannot drift from the DB's events_kind_check constraint.
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

export const EVENT_KINDS = ['dive', 'course', 'adventure'] as const
export type EventKind = typeof EVENT_KINDS[number]

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

// Kinds the calendar offers as a simple on/off toggle. Courses are excluded
// because they filter by course category instead, one row per course type.
export const NON_COURSE_KINDS: readonly EventKind[] = EVENT_KINDS.filter(k => !usesCourseDays(k))

/**
 * True when the shop may lay on transport, so the register form offers ride
 * seats and the admin gets the car-assignment panel. Courses run at the shop;
 * dives and adventures travel to a site.
 */
export function allowsTransport(kind: EventKind): boolean {
  return kind !== 'course'
}

/**
 * True when the kind carries the genuinely diving-specific fields —
 * `is_boat_dive` and `nitrox_required`. Deliberately narrower than
 * `usesDateEnvelope`: `is_trip` rides with the envelope kinds instead, since
 * "runs over several days away from the shop" is not a claim about diving.
 */
export function hasDiveFlags(kind: EventKind): boolean {
  return kind === 'dive'
}

/** Narrow an untrusted string (a request body's event_type) to a known kind. */
export function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value)
}
