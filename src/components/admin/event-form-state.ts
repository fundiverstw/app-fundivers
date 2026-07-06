import type { EventRow } from '../../types/database'

// Form-state shape, defaults, prefill helpers, and the FormState→DB-payload
// converters used by the create + edit pages. Lives in its own file so the
// EventForm component module exports only a component (react-refresh rule).

export type EventType = 'dive' | 'course'

export interface FormState {
  // common
  type: EventType
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
  req_dives: string      // dives store bigint, courses store text — keep as string here
  dive_days: string      // bigint or empty
  addonIds: string[]     // FK multi → addons
  // Plain image URLs the shop hosts itself; the SPA stores and round-trips
  // the text (no upload/resolve).
  featured_image: string // both kinds
  second_image: string   // dive-only — left empty for courses
  // dive
  notes: string          // dive-only NOT NULL
  featured: boolean
  fully_booked: boolean
  is_private: boolean    // dive-only: hidden from diver-facing calendars
  is_boat_dive: boolean  // dive-only, independent of is_trip
  is_trip: boolean       // dive-only: surfaced under Scheduled Trips
  roomIds: string[]      // FK multi → rooms
  nitrox_required: boolean
  gear_rental: string
  cancel_date: string
  cancel_policy: string
  destinationIds: string[]   // FK multi → travel_destinations
  divetravel_reference: string
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
  req_dives: '', dive_days: '',
  addonIds: [],
  featured_image: '', second_image: '',
  notes: '', featured: false, fully_booked: false, is_private: false, is_boat_dive: false, is_trip: false,
  roomIds: [],
  nitrox_required: false, gear_rental: '',
  cancel_date: '', cancel_policy: '',
  destinationIds: [], divetravel_reference: '',
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
}

const NO_RELATIONS: EventRelations = { roomIds: [], addonIds: [], destinationIds: [] }

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
    req_dives: e.req_dives != null ? String(e.req_dives) : '',
    dive_days: e.dive_days != null ? String(e.dive_days) : '',
    addonIds: rels.addonIds,
    fully_booked: !!e.fully_booked,
    cancel_date: e.cancel_date ?? '',
    cancel_policy: e.cancel_policy ?? '',
    full_payment_deadline: e.full_payment_deadline ?? '',
    featured_image: e.featured_image ?? '',
  }

  if (e.kind === 'course') {
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
      second_image: '',
      notes: '', featured: false, is_private: false, is_boat_dive: false, is_trip: false,
      roomIds: [],
      nitrox_required: false, gear_rental: '',
      destinationIds: [], divetravel_reference: '',
    }
  }

  return {
    ...common,
    type: 'dive',
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
    divetravel_reference: e.divetravel_id ?? '',
    second_image: e.second_image ?? '',
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
  const isDive = form.type === 'dive'
  const timeText = form.start_time ? `${form.start_time}:00` : ''
  const days = [...new Set(form.courseDays.filter(Boolean))].sort()
  return {
    kind: form.type,
    admin_title: isDive ? form.admin_title.trim() : (form.admin_title || null),
    display_title: form.display_title.trim() || null,
    calendar_title: form.calendar_title || null,
    price: form.price || null,
    capacity: form.capacity ? Number(form.capacity) : null,
    prereq_cert_id: form.prereq_cert_id || null,
    req_dives: form.req_dives ? Number(form.req_dives) : null,
    dive_days: form.dive_days ? Number(form.dive_days) : null,
    cancel_date: form.cancel_date || null,
    cancel_policy: form.cancel_policy || null,
    fully_booked: form.fully_booked,
    full_payment_deadline: form.full_payment_deadline || null,
    featured_image: form.featured_image.trim() || null,
    start_time: timeText || null,
    // temporal — dive envelope vs course day-list
    start_date: isDive ? (form.start_date || null) : null,
    end_date: isDive ? (form.end_date || null) : null,
    course_days: isDive ? null : (days.length ? days : null),
    // dive-only
    featured: isDive ? form.featured : false,
    is_private: isDive ? form.is_private : false,
    is_boat_dive: isDive ? form.is_boat_dive : false,
    is_trip: isDive ? form.is_trip : false,
    notes: isDive ? form.notes : null,
    nitrox_required: isDive ? form.nitrox_required : false,
    gear_rental: isDive ? (form.gear_rental || null) : null,
    second_image: isDive ? (form.second_image.trim() || null) : null,
    divetravel_id: isDive ? (form.divetravel_reference || null) : null,
    // course-only
    course_name: isDive ? null : (form.course_name || null),
    included: isDive ? null : (form.included || null),
    schedule: isDive ? null : (form.schedule || null),
  }
}
