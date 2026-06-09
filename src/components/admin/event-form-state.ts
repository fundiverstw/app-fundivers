import type { EOCourse, EODive } from '../../types/database'

// Form-state shape, defaults, prefill helpers, and the FormState→DB-payload
// converters used by the create + edit pages. Lives in its own file so the
// EventForm component module exports only a component (react-refresh rule).

export type EventType = 'dive' | 'course'

export interface FormState {
  // common
  type: EventType
  admin_title: string    // internal label admins see (NOT NULL on EO_dives, nullable on EO_courses)
  display_title: string  // diver-facing title; falls back to admin_title on public surfaces
  calendar_title: string // short label for the calendar widget; optional
  start_date: string
  start_time: string     // 'HH:mm' or empty
  end_date: string
  /** Max confirmed bookings before the trigger forces waitlist. Empty = uncapped. */
  capacity: string
  price: string          // FK → EO_prices._id; empty = no price linked
  prereq_cert_id: string // FK → cert_levels.id; empty = no cert required
  req_dives: string      // dives store bigint, courses store text — keep as string here
  dive_days: string      // bigint or empty
  addonIds: string[]     // FK multi → Other_Addons
  // Wix media references — paste from the Wix Media Manager (URI looks
  // like `wix:image://v1/<id>/<filename>#originWidth=…&originHeight=…`).
  // The Wix site reads these directly for hero / gallery rendering; the
  // SPA only stores and round-trips the text.
  featured_image: string // EO_dives + EO_courses
  second_image: string   // EO_dives only — left empty for courses
  // dive
  notes: string          // dive-only NOT NULL
  featured: boolean
  fully_booked: boolean
  is_private: boolean    // dive-only: hidden from diver-facing calendars
  has_rooms: boolean
  roomIds: string[]      // FK multi → EO_rooms (CSV-encoded)
  nitrox_required: boolean
  gear_rental: string
  cancel_date: string
  cancel_policy: string
  destinationIds: string[]   // FK multi → TravelDestinations (JSON-encoded into destination_reference)
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
  notes: '', featured: false, fully_booked: false, is_private: false,
  has_rooms: false, roomIds: [],
  nitrox_required: false, gear_rental: '',
  cancel_date: '', cancel_policy: '',
  destinationIds: [], divetravel_reference: '',
  full_payment_deadline: '',
  courseDays: [], course_name: '',
  included: '', schedule: '',
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

// other_addons can be a JSON array string, a CSV string, or empty (Bubble
// legacy). Try JSON first, fall back to CSV — same shape as the DB-side
// parse_addon_ids() function.
export function parseAddonIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) return parsed.map(String).map(s => s.trim()).filter(Boolean)
    } catch { /* fall through to CSV */ }
  }
  return trimmed.split(',').map(s => s.trim()).filter(Boolean)
}

export function parseCsvIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/** Build a FormState from an existing EO_dives row (used by edit page). */
export function formStateFromDive(d: EODive): FormState {
  return {
    type: 'dive',
    admin_title: d.admin_title ?? '',
    display_title: stripCapacitySuffix(d.display_title),
    calendar_title: d.calendar_title ?? '',
    start_date: d.start_date ?? '',
    start_time: toHhmm(d.time),
    end_date: d.end_date ?? '',
    capacity: d.capacity != null ? String(d.capacity) : '',
    price: d.price ?? '',
    prereq_cert_id: d.prereq_cert_id ?? '',
    req_dives: d.req_dives != null ? String(d.req_dives) : '',
    dive_days: d.dive_days != null ? String(d.dive_days) : '',
    addonIds: parseAddonIds(d.other_addons),
    notes: d.notes ?? '',
    featured: !!d.featured,
    fully_booked: !!d.fully_booked,
    is_private: !!d.is_private,
    has_rooms: !!d.has_rooms,
    roomIds: parseCsvIds(d.room_types),
    nitrox_required: d.nitrox_required ?? false,
    gear_rental: d.gear_rental ?? '',
    cancel_date: d.cancel_date ?? '',
    cancel_policy: d.cancel_policy ?? '',
    destinationIds: parseAddonIds(d.destination_reference),
    divetravel_reference: d.DiveTravel_reference ?? '',
    full_payment_deadline: d.full_payment_deadline ?? '',
    featured_image: d.featured_image ?? '',
    second_image: d.second_image ?? '',
    courseDays: [], course_name: '',
    included: '', schedule: '',
  }
}

/** Build a FormState from an existing EO_courses row (used by edit page). */
export function formStateFromCourse(c: EOCourse): FormState {
  const courseDays = [...new Set((c.course_days ?? []).filter(Boolean))].sort()
  return {
    type: 'course',
    admin_title: c.admin_title ?? '',
    display_title: stripCapacitySuffix(c.display_title),
    calendar_title: c.calendar_title ?? '',
    course_name: c.course_name ?? '',
    // The form's start_date/end_date are derived from courseDays (the
    // course itself has no envelope columns); the form edits courseDays.
    start_date: courseDays[0] ?? '',
    start_time: toHhmm(c.start_time),
    end_date: courseDays[courseDays.length - 1] ?? '',
    capacity: c.capacity != null ? String(c.capacity) : '',
    courseDays,
    price: c.price ?? '',
    prereq_cert_id: c.prereq_cert_id ?? '',
    req_dives: c.req_dives ?? '',
    dive_days: c.dive_days != null ? String(c.dive_days) : '',
    included: c.included ?? '',
    schedule: c.schedule ?? '',
    addonIds: parseAddonIds(c.other_addons),
    full_payment_deadline: c.full_payment_deadline ?? '',
    cancel_date: c.cancel_date ?? '',
    cancel_policy: c.cancel_policy ?? '',
    featured_image: c.featured_image ?? '',
    second_image: '',
    notes: '', featured: false, fully_booked: false, is_private: false,
    has_rooms: false, roomIds: [],
    nitrox_required: false, gear_rental: '',
    destinationIds: [], divetravel_reference: '',
  }
}

/**
 * Convert a FormState into the row shape for `EO_dives` insert/update.
 * Used by both create and edit pages so both stay in sync forever.
 */
export function divePayloadFromForm(form: FormState): Record<string, unknown> {
  // Bubble's time format includes seconds; pad if the input was 'HH:mm'.
  const timeText = form.start_time ? `${form.start_time}:00` : ''
  const addonsJson = form.addonIds.length ? JSON.stringify(form.addonIds) : ''
  return {
    admin_title: form.admin_title.trim(),
    display_title: form.display_title || null,
    calendar_title: form.calendar_title || null,
    start_date: form.start_date || null,
    time: timeText || null,
    end_date: form.end_date || null,
    capacity: form.capacity ? Number(form.capacity) : null,
    price: form.price || null,
    notes: form.notes,                   // NOT NULL — empty string OK
    featured: form.featured,
    fully_booked: form.fully_booked,
    is_private: form.is_private,
    prereq_cert_id: form.prereq_cert_id || null,
    req_dives: form.req_dives ? Number(form.req_dives) : null,
    dive_days: form.dive_days ? Number(form.dive_days) : null,
    gear_rental: form.gear_rental || null,
    nitrox_required: form.nitrox_required,
    has_rooms: form.has_rooms,
    room_types: form.roomIds.join(','),
    hasotheraddons: form.addonIds.length > 0,
    other_addons: addonsJson,
    cancel_date: form.cancel_date || null,
    cancel_policy: form.cancel_policy || null,
    destination_reference: form.destinationIds.length ? JSON.stringify(form.destinationIds) : null,
    DiveTravel_reference: form.divetravel_reference || null,
    full_payment_deadline: form.full_payment_deadline || null,
    featured_image: form.featured_image.trim() || null,
    second_image: form.second_image.trim() || null,
  }
}

/**
 * Convert a FormState into the row shape for `EO_courses` insert/update.
 */
export function coursePayloadFromForm(form: FormState): Record<string, unknown> {
  const timeText = form.start_time ? `${form.start_time}:00` : ''
  const addonsJson = form.addonIds.length ? JSON.stringify(form.addonIds) : ''
  // Sort + dedupe the entered days. course_days is the sole date source —
  // there's no start_date/end_date envelope on EO_courses anymore.
  const days = [...new Set(form.courseDays.filter(Boolean))].sort()
  return {
    admin_title: form.admin_title || null,
    display_title: form.display_title.trim() || null,
    calendar_title: form.calendar_title || null,
    course_name: form.course_name || null,
    start_time: timeText || null,
    capacity: form.capacity ? Number(form.capacity) : null,
    course_days: days.length ? days : null,
    price: form.price || null,
    prereq_cert_id: form.prereq_cert_id || null,
    req_dives: form.req_dives || null,    // text on courses
    dive_days: form.dive_days ? Number(form.dive_days) : null,
    included: form.included || null,
    schedule: form.schedule || null,
    other_addons: addonsJson,
    full_payment_deadline: form.full_payment_deadline || null,
    cancel_date: form.cancel_date || null,
    cancel_policy: form.cancel_policy || null,
    featured_image: form.featured_image.trim() || null,
  }
}
