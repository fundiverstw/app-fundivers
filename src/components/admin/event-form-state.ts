import type { EOCourse, EODive } from '../../types/database'

// Form-state shape, defaults, prefill helpers, and the FormState→DB-payload
// converters used by the create + edit pages. Lives in its own file so the
// EventForm component module exports only a component (react-refresh rule).

export type EventType = 'dive' | 'course'

export interface FormState {
  // common
  type: EventType
  title: string          // → admin_title for dives, display_title for courses (required for dives)
  subtitle: string       // → display_title for dives, calendar_title for courses
  start_date: string
  start_time: string     // 'HH:mm' or empty
  end_date: string
  price: string          // FK → EO_prices._id; empty = no price linked
  featured_image: string
  prereq_cert_id: string // FK → cert_levels.id; empty = no cert required
  prereqs: string        // free-form notes (e.g. "20+ logged dives")
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
  second_image: string
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
  starting_at: string    // integer or empty
}

export const EMPTY_FORM: FormState = {
  type: 'dive',
  title: '', subtitle: '',
  start_date: '', start_time: '', end_date: '',
  price: '', featured_image: '',
  prereq_cert_id: '', prereqs: '',
  req_dives: '', dive_days: '',
  addonIds: [],
  notes: '', featured: false, fully_booked: false,
  has_rooms: false, roomIds: [],
  nitrox_required: false, gear_rental: '',
  cancel_date: '', cancel_policy: '',
  destinationIds: [], second_image: '', divetravel_reference: '',
  deposit_deadline: '', full_payment_deadline: '',
  special_date: '', url: '', course_name: '',
  included: '', schedule: '', starting_at: '',
}

function toHhmm(raw: string | null | undefined): string {
  if (!raw) return ''
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
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
    title: d.admin_title ?? '',
    subtitle: d.display_title ?? '',
    start_date: d.start_date ?? '',
    start_time: toHhmm(d.time),
    end_date: d.end_date ?? '',
    price: d.price ?? '',
    featured_image: d.featured_image ?? '',
    prereq_cert_id: d.prereq_cert_id ?? '',
    prereqs: d.prereqs ?? '',
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
    second_image: d.second_image ?? '',
    divetravel_reference: d.DiveTravel_reference ?? '',
    deposit_deadline: d.deposit_deadline ?? '',
    full_payment_deadline: d.full_payment_deadline ?? '',
    special_date: '', url: '', course_name: '',
    included: '', schedule: '', starting_at: '',
  }
}

/** Build a FormState from an existing EO_courses row (used by edit page). */
export function formStateFromCourse(c: EOCourse): FormState {
  return {
    type: 'course',
    title: c.display_title ?? '',
    subtitle: c.calendar_title ?? '',
    course_name: c.course_name ?? '',
    start_date: c.start_date ?? '',
    start_time: toHhmm(c.start_time),
    end_date: c.end_date ?? '',
    special_date: c.special_date ?? '',
    price: c.price ?? '',
    featured_image: c.featured_image ?? '',
    url: c.URL ?? '',
    prereq_cert_id: c.prereq_cert_id ?? '',
    prereqs: c.prereqs ?? '',
    req_dives: c.req_dives ?? '',
    dive_days: c.dive_days != null ? String(c.dive_days) : '',
    included: c.included ?? '',
    schedule: c.schedule ?? '',
    starting_at: c.starting_at != null ? String(c.starting_at) : '',
    addonIds: parseAddonIds(c.other_addons),
    deposit_deadline: c.deposit_deadline ?? '',
    full_payment_deadline: c.full_payment_deadline ?? '',
    cancel_date: c.cancel_date ?? '',
    cancel_policy: c.cancel_policy ?? '',
    notes: '', featured: false, fully_booked: false,
    has_rooms: false, roomIds: [],
    nitrox_required: false, gear_rental: '',
    destinationIds: [], second_image: '', divetravel_reference: '',
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
    admin_title: form.title.trim(),
    display_title: form.subtitle || null,
    start_date: form.start_date || null,
    time: timeText || null,
    end_date: form.end_date || null,
    price: form.price || null,
    featured_image: form.featured_image || null,
    second_image: form.second_image || null,
    notes: form.notes,                   // NOT NULL — empty string OK
    featured: form.featured,
    fully_booked: form.fully_booked,
    prereq_cert_id: form.prereq_cert_id || null,
    prereqs: form.prereqs || null,
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
    display_title: form.title.trim() || null,
    calendar_title: form.subtitle || null,
    course_name: form.course_name || null,
    start_date: form.start_date || null,
    start_time: timeText || null,
    end_date: form.end_date || null,
    special_date: form.special_date || null,
    price: form.price || null,
    featured_image: form.featured_image || null,
    URL: form.url || null,
    prereq_cert_id: form.prereq_cert_id || null,
    prereqs: form.prereqs || null,
    req_dives: form.req_dives || null,    // text on courses
    dive_days: form.dive_days ? Number(form.dive_days) : null,
    included: form.included || null,
    schedule: form.schedule || null,
    starting_at: form.starting_at ? Number(form.starting_at) : null,
    other_addons: addonsJson,
    deposit_deadline: form.deposit_deadline || null,
    full_payment_deadline: form.full_payment_deadline || null,
    cancel_date: form.cancel_date || null,
    cancel_policy: form.cancel_policy || null,
  }
}
