import type { EventRow, EventKind } from '../../types/database'
import { usesDateEnvelope, usesCourseDays, hasDiveFlags, recordsSiteConditions, entersTheWater } from '../../lib/event-kinds'

// Form-state shape, defaults, prefill helpers, and the FormState→DB-payload
// converters used by the create + edit pages. Lives in its own file so the
// EventForm component module exports only a component (react-refresh rule).

export interface FormState {
  // common
  type: EventKind
  admin_title: string    // internal label admins see (trimmed+required for dives, optional for courses)
  display_title: string  // diver-facing title; falls back to admin_title on public surfaces
  calendar_title: string // short label for the calendar widget; optional
  start_date: string
  start_time: string     // 'HH:mm' or empty
  end_date: string
  /** Max confirmed bookings before the trigger forces waitlist. Empty = uncapped. */
  capacity: string
  price: string          // FK → prices.id; empty = no price linked
  prereq_cert_id: string // FK → cert_levels.id; empty = no cert required
  site_id: string        // FK → dive_sites.id; empty = no site (always for courses)
  req_dives: string      // dives store bigint, courses store text — keep as string here
  dive_days: string      // bigint or empty
  addonIds: string[]     // FK multi → addons
  // FK multi → discounts: which of the shop's discounts this event offers at
  // registration. Nothing here changes a price -- a diver asking for one still
  // waits on an admin's approval.
  discountIds: string[]
  // Plain image URLs the shop hosts itself; the SPA stores and round-trips
  // the text (no upload/resolve).
  featured_image: string // both kinds
  // dive
  notes: string          // dive-only NOT NULL
  featured: boolean
  fully_booked: boolean
  is_private: boolean    // dive-only: hidden from diver-facing calendars
  is_boat_dive: boolean  // dive-only, independent of is_trip
  is_trip: boolean       // dive-only: multi-day/liveaboard classification (mirrored to Wix)
  roomIds: string[]      // FK multi → rooms
  nitrox_required: boolean
  gear_rental: string
  // Every kind: no gear question at registration, no gear in the price.
  gear_included: boolean
  // Dive + course: do the people who register actually get in the water? An
  // EFR class, an equipment course and a BBQ say no, and the logistics board
  // then counts them as non-divers. An adventure answers no by kind.
  enters_water: boolean
  cancel_date: string
  cancel_policy: string
  destinationIds: string[]   // FK multi → travel_destinations
  trip_template_reference: string
  // full-payment deadline (both event types) — empty string = unset, falls
  // back client-side to "7 days before start_date". The deposit is always
  // "ASAP" and has no per-event deadline.
  full_payment_deadline: string
  // course — the explicit dates a course runs on (max 4). Adjacent dates
  // render as one continuous calendar bar; gaps render as separate pills.
  courseDays: string[]
  course_name: string
  included: string
  schedule: string
}

export const EMPTY_FORM: FormState = {
  type: 'dive',
  admin_title: '', display_title: '', calendar_title: '',
  start_date: '', start_time: '', end_date: '',
  capacity: '',
  price: '',
  prereq_cert_id: '',
  site_id: '',
  req_dives: '', dive_days: '',
  addonIds: [], discountIds: [],
  featured_image: '',
  notes: '', featured: false, fully_booked: false, is_private: false, is_boat_dive: false, is_trip: false,
  roomIds: [],
  nitrox_required: false, gear_rental: '', gear_included: false, enters_water: true,
  cancel_date: '', cancel_policy: '',
  destinationIds: [], trip_template_reference: '',
  full_payment_deadline: '',
  courseDays: [], course_name: '',
  included: '', schedule: '',
}

/**
 * An event's related catalog ids, held in the junction tables (the single
 * source of truth). Loaded alongside an event for editing/preload, and written
 * back via the set_event_relations RPC. See src/lib/event-relations.ts.
 */
export interface EventRelations {
  roomIds: string[]
  addonIds: string[]
  destinationIds: string[]
  discountIds: string[]
}

const NO_RELATIONS: EventRelations = {
  roomIds: [], addonIds: [], destinationIds: [], discountIds: [],
}

function toHhmm(raw: string | null | undefined): string {
  if (!raw) return ''
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

/**
 * Strip the capacity suffix the DB trigger appends to display_title (see
 * migration 20260514020000) so admins editing an event see the clean base
 * title in the form. On save the trigger re-appends the live suffix.
 *
 * Mirrors strip_capacity_suffix() in plpgsql — keep the regexes aligned.
 */
function stripCapacitySuffix(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw.replace(/\s*\((?:\d+\s*spots?\s*open|fully booked\s*[-–—]+\s*register for waitlist)\)\s*$/i, '')
}

/**
 * Build a FormState from an existing events row (edit page + preload picker).
 * Branches on `kind` for the per-kind fields. Room/add-on/destination ids come
 * from the junction tables via `rels`, not the row.
 */
export function formStateFromEvent(e: EventRow, rels: EventRelations = NO_RELATIONS): FormState {
  const common = {
    admin_title: e.admin_title ?? '',
    display_title: stripCapacitySuffix(e.display_title),
    calendar_title: e.calendar_title ?? '',
    start_time: toHhmm(e.start_time),
    capacity: e.capacity != null ? String(e.capacity) : '',
    price: e.price ?? '',
    prereq_cert_id: e.prereq_cert_id ?? '',
    site_id: e.site_id ?? '',
    req_dives: e.req_dives != null ? String(e.req_dives) : '',
    dive_days: e.dive_days != null ? String(e.dive_days) : '',
    addonIds: rels.addonIds,
    discountIds: rels.discountIds,
    fully_booked: !!e.fully_booked,
    cancel_date: e.cancel_date ?? '',
    cancel_policy: e.cancel_policy ?? '',
    full_payment_deadline: e.full_payment_deadline ?? '',
    featured_image: e.featured_image ?? '',
    gear_included: e.gear_included ?? false,
    enters_water: e.enters_water ?? true,
  }

  if (usesCourseDays(e.kind)) {
    const courseDays = [...new Set((e.course_days ?? []).filter(Boolean))].sort()
    return {
      ...common,
      type: 'course',
      // The form's start/end are derived from courseDays (courses have no envelope).
      start_date: courseDays[0] ?? '',
      end_date: courseDays[courseDays.length - 1] ?? '',
      courseDays,
      course_name: e.course_name ?? '',
      included: e.included ?? '',
      schedule: e.schedule ?? '',
      notes: '', featured: false, is_private: false, is_boat_dive: false, is_trip: false,
      roomIds: [],
      nitrox_required: false, gear_rental: '',
      destinationIds: [], trip_template_reference: '',
    }
  }

  // Envelope kinds (dive, and any other kind that carries start/end dates).
  // `type: e.kind` rather than a literal — hardcoding 'dive' here would load an
  // event of any other envelope kind into the form AS a dive, and save it back
  // that way.
  return {
    ...common,
    type: e.kind,
    start_date: e.start_date ?? '',
    end_date: e.end_date ?? '',
    notes: e.notes ?? '',
    featured: !!e.featured,
    is_private: !!e.is_private,
    is_boat_dive: !!e.is_boat_dive,
    is_trip: !!e.is_trip,
    roomIds: rels.roomIds,
    nitrox_required: e.nitrox_required ?? false,
    gear_rental: e.gear_rental ?? '',
    destinationIds: rels.destinationIds,
    trip_template_reference: e.trip_template_id ?? '',
    courseDays: [], course_name: '',
    included: '', schedule: '',
  }
}

/**
 * Convert a FormState into the row shape for `events` insert/update — one
 * builder, setting `kind` and nulling the columns that don't apply to the kind.
 * Rooms/add-ons/destinations are written separately to the junction tables via
 * the set_event_relations RPC.
 */
export function eventPayloadFromForm(form: FormState): Record<string, unknown> {
  // Three separate questions, not one. `isDive` used to answer all of them,
  // which is why every field below had to be re-decided by hand.
  const envelope   = usesDateEnvelope(form.type)  // start/end dates vs a day list
  const courseOnly = usesCourseDays(form.type)    // course_name / included / schedule
  const diving     = hasDiveFlags(form.type)      // boat dives, nitrox
  const timeText = form.start_time ? `${form.start_time}:00` : ''
  const days = [...new Set(form.courseDays.filter(Boolean))].sort()
  return {
    kind: form.type,
    admin_title: courseOnly ? (form.admin_title || null) : form.admin_title.trim(),
    display_title: form.display_title.trim() || null,
    calendar_title: form.calendar_title || null,
    price: form.price || null,
    capacity: form.capacity ? Number(form.capacity) : null,
    prereq_cert_id: form.prereq_cert_id || null,
    // A course runs from the shop, so it never carries a site even if one was
    // picked before the kind was switched.
    site_id: recordsSiteConditions(form.type) ? (form.site_id || null) : null,
    req_dives: form.req_dives ? Number(form.req_dives) : null,
    dive_days: form.dive_days ? Number(form.dive_days) : null,
    cancel_date: form.cancel_date || null,
    cancel_policy: form.cancel_policy || null,
    fully_booked: form.fully_booked,
    full_payment_deadline: form.full_payment_deadline || null,
    featured_image: form.featured_image.trim() || null,
    start_time: timeText || null,
    // temporal — dive envelope vs course day-list
    start_date: envelope ? (form.start_date || null) : null,
    end_date: envelope ? (form.end_date || null) : null,
    course_days: courseOnly ? (days.length ? days : null) : null,
    // dive-only
    featured: courseOnly ? false : form.featured,
    is_private: courseOnly ? false : form.is_private,
    is_boat_dive: diving ? form.is_boat_dive : false,
    is_trip: envelope ? form.is_trip : false,
    notes: courseOnly ? null : form.notes,
    nitrox_required: diving ? form.nitrox_required : false,
    gear_rental: courseOnly ? null : (form.gear_rental || null),
    // Every kind answers this one: a course bundles a set, a dry course or a
    // non-diving outing needs none, a fun dive rents a-la-carte.
    gear_included: form.gear_included,
    // Unreachable on an adventure rather than merely unticked: the kind
    // already says nobody goes under, so the form offers no box and the row
    // says the same thing the app does — see eventEntersWater().
    enters_water: entersTheWater(form.type) ? form.enters_water : false,
    trip_template_id: courseOnly ? null : (form.trip_template_reference || null),
    // course-only
    course_name: courseOnly ? (form.course_name || null) : null,
    included: courseOnly ? (form.included || null) : null,
    schedule: courseOnly ? (form.schedule || null) : null,
  }
}
