import { supabase } from './supabase'
import type { AppEvent, EOCourse, EODive, EOPrice } from '../types/database'

/**
 * Build an ISO timestamp from EO_* text columns. start_date is 'YYYY-MM-DD';
 * time/start_time is 'HH:MM:SS.SSS' or empty. Defaults midnight when missing.
 */
function toIso(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null
  const t = time && time.trim() ? time.trim() : '00:00:00'
  // Ensure 'T' separator for ISO-ish parsing. Treating as local time (no TZ suffix).
  return new Date(`${date}T${t}`).toISOString()
}

function diveToEvent(d: EODive, priceIndex: Map<string, EOPrice>): AppEvent | null {
  const start = toIso(d.start_date, d.time)
  if (!start) return null
  const p = d.price ? priceIndex.get(d.price) : undefined
  return {
    id: d._id,
    type: 'dive',
    title: d.dive_title || d.title || 'Dive',
    start_time: start,
    end_time: toIso(d.end_date, d.time),
    featured: d.featured ?? false,
    fully_booked: d.fully_booked ?? false,
    price: p?.starting_at ?? null,
    currency: 'TWD',
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
    currency: 'TWD',
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

/** Fetch dives + courses whose start_date falls within [fromDate, toDate] (inclusive, 'YYYY-MM-DD'). */
export async function fetchEventsInRange(fromDate: string, toDate: string): Promise<AppEvent[]> {
  const [divesResp, coursesResp] = await Promise.all([
    supabase
      .from('EO_dives')
      .select('_id, dive_title, title, start_date, time, end_date, featured, fully_booked, price')
      .gte('start_date', fromDate)
      .lte('start_date', toDate)
      .order('start_date'),
    supabase
      .from('EO_courses')
      .select('_id, course_title, title, start_date, start_time, end_date, price')
      .gte('start_date', fromDate)
      .lte('start_date', toDate)
      .order('start_date'),
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
      ? supabase.from('EO_dives').select('_id, dive_title, title, start_date, time, end_date, featured, fully_booked, price').in('_id', diveIds)
      : Promise.resolve({ data: [] as EODive[] }),
    courseIds.length
      ? supabase.from('EO_courses').select('_id, course_title, title, start_date, start_time, end_date, price').in('_id', courseIds)
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
