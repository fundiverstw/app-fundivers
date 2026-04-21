import { supabase } from './supabase'
import type { AppEvent, EOCourse, EODive, EOPrice } from '../types/database'

/**
 * Build an ISO timestamp from EO_* text columns. start_date is 'YYYY-MM-DD';
 * time/start_time is 'HH:MM:SS.SSS' or empty. Defaults midnight when missing.
 */
function toIso(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null
  const t = time && time.trim() ? time.trim() : '00:00:00'
  return new Date(`${date}T${t}`).toISOString()
}

/** `"id1,id2"` → `['id1','id2']`. Handles null/whitespace. */
function parseCsvIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

/** `'["id1","id2"]'` → `['id1','id2']`. Tolerates CSV fallback and null. */
function parseJsonIds(raw: string | null | undefined): string[] {
  if (!raw) return []
  const s = raw.trim()
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s)
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
    } catch {
      return []
    }
  }
  return parseCsvIds(s)
}

function diveToEvent(d: EODive, priceIndex: Map<string, EOPrice>): AppEvent | null {
  const start = toIso(d.start_date, d.time)
  if (!start) return null
  const p = d.price ? priceIndex.get(d.price) : undefined
  const gearText = d.gear_rental && d.gear_rental.trim() ? d.gear_rental.trim() : null
  return {
    id: d._id,
    type: 'dive',
    title: d.dive_title || d.title || 'Dive',
    start_time: start,
    end_time: toIso(d.end_date, d.time),
    featured: d.featured ?? false,
    fully_booked: d.fully_booked ?? false,
    price: p?.starting_at ?? null,
    deposit_amount: p?.deposit_amount ?? null,
    currency: 'TWD',
    has_rooms: Boolean(d.has_rooms),
    room_type_ids: parseCsvIds(d.room_types),
    has_addons: Boolean(d.hasotheraddons),
    addon_ids: parseJsonIds(d.other_addons),
    gear_rental_info: gearText,
    nitrox_required: (d.nitrox_required ?? '').toLowerCase() === 'true',
    dive_days: d.dive_days ?? null,
  }
}

function courseToEvent(c: EOCourse, priceIndex: Map<string, EOPrice>): AppEvent | null {
  const start = toIso(c.start_date, c.start_time)
  if (!start) return null
  const p = c.price ? priceIndex.get(c.price) : undefined
  return {
    id: c._id,
    type: 'course',
    title: c.course_title || c.title || 'Course',
    start_time: start,
    end_time: toIso(c.end_date, c.start_time),
    featured: false,
    fully_booked: false,
    price: p?.starting_at ?? null,
    deposit_amount: p?.deposit_amount ?? null,
    currency: 'TWD',
    has_rooms: false,
    room_type_ids: [],
    has_addons: !!c.other_addons && parseJsonIds(c.other_addons).length > 0,
    addon_ids: parseJsonIds(c.other_addons),
    gear_rental_info: null,
    nitrox_required: false,
    dive_days: c.dive_days ?? null,
  }
}

async function attachPrices(dives: EODive[], courses: EOCourse[]): Promise<Map<string, EOPrice>> {
  const priceIds = [
    ...dives.map(d => d.price),
    ...courses.map(c => c.price),
  ].filter((x): x is string => !!x)

  if (!priceIds.length) return new Map()

  const { data } = await supabase
    .from('EO_prices')
    .select('_id, title, starting_at, deposit_amount')
    .in('_id', [...new Set(priceIds)])

  return new Map((data ?? []).map(p => [p._id, p as EOPrice]))
}

const DIVE_COLS = '_id, dive_title, title, start_date, time, end_date, featured, fully_booked, price, has_rooms, room_types, hasotheraddons, other_addons, gear_rental, nitrox_required, dive_days'
const COURSE_COLS = '_id, course_title, title, start_date, start_time, end_date, price, other_addons, dive_days'

/** Fetch dives + courses whose start_date falls within [fromDate, toDate] (inclusive, 'YYYY-MM-DD'). */
export async function fetchEventsInRange(fromDate: string, toDate: string): Promise<AppEvent[]> {
  const [divesResp, coursesResp] = await Promise.all([
    supabase.from('EO_dives').select(DIVE_COLS).gte('start_date', fromDate).lte('start_date', toDate).order('start_date'),
    supabase.from('EO_courses').select(COURSE_COLS).gte('start_date', fromDate).lte('start_date', toDate).order('start_date'),
  ])

  const dives = (divesResp.data ?? []) as EODive[]
  const courses = (coursesResp.data ?? []) as EOCourse[]
  const prices = await attachPrices(dives, courses)

  return [
    ...dives.map(d => diveToEvent(d, prices)).filter((x): x is AppEvent => !!x),
    ...courses.map(c => courseToEvent(c, prices)).filter((x): x is AppEvent => !!x),
  ].sort((a, b) => a.start_time.localeCompare(b.start_time))
}

/** Fetch the events referenced by a batch of bookings. */
export async function fetchEventsForBookings(
  diveIds: string[],
  courseIds: string[]
): Promise<Map<string, AppEvent>> {
  const [divesResp, coursesResp] = await Promise.all([
    diveIds.length
      ? supabase.from('EO_dives').select(DIVE_COLS).in('_id', diveIds)
      : Promise.resolve({ data: [] as EODive[] }),
    courseIds.length
      ? supabase.from('EO_courses').select(COURSE_COLS).in('_id', courseIds)
      : Promise.resolve({ data: [] as EOCourse[] }),
  ])

  const dives = (divesResp.data ?? []) as EODive[]
  const courses = (coursesResp.data ?? []) as EOCourse[]
  const prices = await attachPrices(dives, courses)

  const out = new Map<string, AppEvent>()
  for (const d of dives) {
    const ev = diveToEvent(d, prices)
    if (ev) out.set(ev.id, ev)
  }
  for (const c of courses) {
    const ev = courseToEvent(c, prices)
    if (ev) out.set(ev.id, ev)
  }
  return out
}
