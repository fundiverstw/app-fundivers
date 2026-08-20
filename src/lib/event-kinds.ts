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
// where the event is held — so a new kind has to answer each question
// explicitly rather than defaulting into someone else's path.

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
 * True when the event runs on the shop's own premises, so a calendar entry
 * for it has no location of its own and takes the shop address.
 *
 * Deliberately NOT a question about rides. This helper used to be
 * `allowsTransport`, and the claim that a course needs no transport was
 * wrong in both directions: `event_vehicles` accepts any event, the
 * `event_ride_tally` RPC matches ride days against `course_days` as
 * explicitly as against a date envelope, and the shop does drive Open Water
 * students out to the shore days. What the kind gate actually bought was a
 * course register form that never fetched the seat tally, so a full car went
 * unmentioned and the diver was waitlisted by the DB trigger without being
 * told. Whether a ride is on offer is a question about the cars assigned to
 * an event, and only the tally can answer it.
 */
export function heldAtShop(kind: EventKind): boolean {
  return kind === 'course'
}

/**
 * True when the kind is taught rather than led — a qualified instructor runs
 * it, and a guide rostered onto it is assisting, not delivering it.
 *
 * Deliberately its own question rather than a reuse of `usesCourseDays`, even
 * though both answer "course" today. One is about the shape of the dates, the
 * other about who is qualified to earn from the event; a fourth kind could
 * easily be taught without running on a `course_days` list, and revenue
 * attribution reads this one — see `earnsRevenue` in staff-revenue.ts.
 */
export function isInstructorLed(kind: EventKind): boolean {
  return kind === 'course'
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

/**
 * True when the kind travels overland, so an almanac observation for it
 * carries terrain readings — elevation, route surface, whether the summit was
 * out. Its own question rather than a reuse of `hasDiveFlags`'s inverse: a
 * future kind could be neither a dive nor a climb, and would then have to say
 * so here rather than inheriting a form section it has no use for.
 */
export function hasTerrainConditions(kind: EventKind): boolean {
  return kind === 'adventure'
}

/**
 * True when the shop travels out to a site for it, so there are conditions at
 * that site worth reporting — the almanac only collects observations for these
 * kinds, and its dive/adventure toggle is this list. A course runs from the
 * shop, so it has no site of its own to describe.
 *
 * Its own question rather than a reuse of `heldAtShop`'s inverse, even though
 * both answer "not a course" today: one decides which address a calendar entry
 * carries, the other whether a kind can be observed at all.
 */
export function recordsSiteConditions(kind: EventKind): boolean {
  return kind !== 'course'
}

/** The kinds the almanac collects observations for, in vocabulary order. */
export const SITE_CONDITION_KINDS: readonly EventKind[] = EVENT_KINDS.filter(recordsSiteConditions)

/** Narrow an untrusted string (a request body's event_type) to a known kind. */
export function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value)
}
