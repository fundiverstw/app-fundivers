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
  // dive
  notes: string          // dive-only NOT NULL
  featured: boolean
  fully_booked: boolean
  has_rooms: boolean
  roomIds: string[]      // FK multi → EO_rooms (CSV-encoded)
  nitrox_required: boolean
  gear_rental: string
  cancel_date: string
  cancel_policy: string
  destinationIds: string[]   // FK multi → TravelDestinations (JSON-encoded into destination_reference)
  divetravel_reference: string
  // payment deadlines (both event types) — empty string = unset, falls back
  // client-side to "7 days before start_date".
  deposit_deadline: string
  full_payment_deadline: string
  // course
  special_date: string
  url: string
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
  notes: '', featured: false, fully_booked: false,
  has_rooms: false, roomIds: [],
  nitrox_required: false, gear_rental: '',
  cancel_date: '', cancel_policy: '',
  destinationIds: [], divetravel_reference: '',
  deposit_deadline: '', full_payment_deadline: '',
  special_date: '', url: '', course_name: '',
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
    has_rooms: !!d.has_rooms,
    roomIds: parseCsvIds(d.room_types),
    nitrox_required: d.nitrox_required ?? false,
    gear_rental: d.gear_rental ?? '',
    cancel_date: d.cancel_date ?? '',
    cancel_policy: d.cancel_policy ?? '',
    destinationIds: parseAddonIds(d.destination_reference),
    divetravel_reference: d.DiveTravel_reference ?? '',
    deposit_deadline: d.deposit_deadline ?? '',
    full_payment_deadline: d.full_payment_deadline ?? '',
    special_date: '', url: '', course_name: '',
    included: '', schedule: '',
  }
}

/** Build a FormState from an existing EO_courses row (used by edit page). */
export function formStateFromCourse(c: EOCourse): FormState {
  return {
    type: 'course',
    admin_title: c.admin_title ?? '',
    display_title: stripCapacitySuffix(c.display_title),
    calendar_title: c.calendar_title ?? '',
    course_name: c.course_name ?? '',
    start_date: c.start_date ?? '',
    start_time: toHhmm(c.start_time),
    end_date: c.end_date ?? '',
    capacity: c.capacity != null ? String(c.capacity) : '',
    special_date: c.special_date ?? '',
    price: c.price ?? '',
    url: c.URL ?? '',
    prereq_cert_id: c.prereq_cert_id ?? '',
    req_dives: c.req_dives ?? '',
    dive_days: c.dive_days != null ? String(c.dive_days) : '',
    included: c.included ?? '',
    schedule: c.schedule ?? '',
    addonIds: parseAddonIds(c.other_addons),
    deposit_deadline: c.deposit_deadline ?? '',
    full_payment_deadline: c.full_payment_deadline ?? '',
    cancel_date: c.cancel_date ?? '',
    cancel_policy: c.cancel_policy ?? '',
    notes: '', featured: false, fully_booked: false,
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
    deposit_deadline: form.deposit_deadline || null,
    full_payment_deadline: form.full_payment_deadline || null,
  }
}

/**
 * Convert a FormState into the row shape for `EO_courses` insert/update.
 */
export function coursePayloadFromForm(form: FormState): Record<string, unknown> {
  const timeText = form.start_time ? `${form.start_time}:00` : ''
  const addonsJson = form.addonIds.length ? JSON.stringify(form.addonIds) : ''
  return {
    admin_title: form.admin_title || null,
    display_title: form.display_title.trim() || null,
    calendar_title: form.calendar_title || null,
    course_name: form.course_name || null,
    start_date: form.start_date || null,
    start_time: timeText || null,
    end_date: form.end_date || null,
    capacity: form.capacity ? Number(form.capacity) : null,
    special_date: form.special_date || null,
    price: form.price || null,
    URL: form.url || null,
    prereq_cert_id: form.prereq_cert_id || null,
    req_dives: form.req_dives || null,    // text on courses
    dive_days: form.dive_days ? Number(form.dive_days) : null,
    included: form.included || null,
    schedule: form.schedule || null,
    other_addons: addonsJson,
    deposit_deadline: form.deposit_deadline || null,
    full_payment_deadline: form.full_payment_deadline || null,
    cancel_date: form.cancel_date || null,
    cancel_policy: form.cancel_policy || null,
  }
}
