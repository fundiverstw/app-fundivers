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

/** YYYY-MM-DD text date → simple comparable key. Accepts ISO dates and trims off time. */
function toDateKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  return s.slice(0, 10) // 'YYYY-MM-DD'
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

/**
 * Courses may carry a `special_date` representing a separate session that
 * should appear as its own pill on the calendar. Wix's calendar.js (lines
 * 39–75) emits 1, 2 or 2-merged segments depending on how `special_date`
 * relates to start/end. We mirror those four branches so our calendar
 * looks like the Wix one.
 *
 * All returned segments share the course's `_id` (so clicking either goes
 * to the same booking target).
 */
function courseToEvents(c: EOCourse, priceIndex: Map<string, EOPrice>): AppEvent[] {
  const startKey = toDateKey(c.start_date)
  if (!startKey) return []
  const endKey = toDateKey(c.end_date) || startKey
  const specialKey = toDateKey((c as EOCourse & { special_date?: string | null }).special_date ?? null)

  const p = c.price ? priceIndex.get(c.price) : undefined
  const shared = {
    id: c._id,
    type: 'course' as const,
    title: c.course_title || c.title || 'Course',
    featured: false,
    fully_booked: false,
    price: p?.starting_at ?? null,
    deposit_amount: p?.deposit_amount ?? null,
    currency: 'TWD',
    has_rooms: false,
    room_type_ids: [] as string[],
    has_addons: !!c.other_addons && parseJsonIds(c.other_addons).length > 0,
    addon_ids: parseJsonIds(c.other_addons),
    gear_rental_info: null,
    nitrox_required: false,
    dive_days: c.dive_days ?? null,
  }

  const makeSegment = (fromKey: string, toKey: string): AppEvent | null => {
    const start = toIso(fromKey, c.start_time)
    if (!start) return null
    const end = toIso(toKey, c.start_time)
    return { ...shared, start_time: start, end_time: end }
  }

  // 1. No special_date → single segment spanning the main range
  if (!specialKey) {
    const only = makeSegment(startKey, endKey)
    return only ? [only] : []
  }

  // 2. special_date == end_date → start-only + end-only (two separate day pills)
  if (specialKey === endKey) {
    return [makeSegment(startKey, startKey), makeSegment(endKey, endKey)].filter((x): x is AppEvent => !!x)
  }

  // 3. special is adjacent to start_date (±1 day) → merged [start..special] + [end alone]
  if (Math.abs(dayDiff(startKey, specialKey)) === 1) {
    const [a, b] = startKey < specialKey ? [startKey, specialKey] : [specialKey, startKey]
    return [makeSegment(a, b), makeSegment(endKey, endKey)].filter((x): x is AppEvent => !!x)
  }

  // 4. special is adjacent to end_date (±1 day) → [start alone] + merged [end..special]
  if (Math.abs(dayDiff(endKey, specialKey)) === 1) {
    const [a, b] = endKey < specialKey ? [endKey, specialKey] : [specialKey, endKey]
    return [makeSegment(startKey, startKey), makeSegment(a, b)].filter((x): x is AppEvent => !!x)
  }

  // 5. Far apart → full [start..end] + lone [special]
  return [makeSegment(startKey, endKey), makeSegment(specialKey, specialKey)]
    .filter((x): x is AppEvent => !!x)
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
const COURSE_COLS = '_id, course_title, title, start_date, start_time, end_date, price, other_addons, dive_days, special_date'

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
    ...courses.flatMap(c => courseToEvents(c, prices)),
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
    // For per-booking lookups we want a single representative entry per course.
    // Use the first (main) segment — its dates reflect the primary range.
    const segs = courseToEvents(c, prices)
    if (segs.length > 0) out.set(segs[0].id, segs[0])
  }
  return out
}
