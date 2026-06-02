import { format, isSameDay, parseISO } from 'date-fns'
import { supabase } from './supabase'
import type { AppEvent, EOCourse, EODive, EOPrice } from '../types/database'

/**
 * Render an event's date span as a human string. Policy:
 *   - When `start_time_hhmm` is set, append ` · HH:mm` (24h) so the start
 *     time is visible everywhere events are listed. Existing rows without a
 *     time set keep the date-only output.
 *   - Single-day events show one date, not a "→ same date" range.
 *   - `style` controls formality: 'long' (Saturday, May 1), 'short' (Sat,
 *     May 1; default), 'compact' (May 1, no weekday).
 */
export function formatEventSpan(
  event: Pick<AppEvent, 'start_time' | 'end_time' | 'start_time_hhmm'>,
  opts: { style?: 'long' | 'short' | 'compact'; withYear?: boolean } = {},
): string {
  const style = opts.style ?? 'short'
  const year = opts.withYear ? ' yyyy' : ''
  const start = parseISO(event.start_time)
  const end = event.end_time ? parseISO(event.end_time) : null
  const singleDay = !end || isSameDay(start, end)
  const startFmt = ({
    long:    'EEEE, MMMM d',
    short:   'EEE, MMM d',
    compact: 'MMM d',
  }[style]) + year
  const timeSuffix = event.start_time_hhmm ? ` · ${event.start_time_hhmm}` : ''
  if (singleDay) return format(start, startFmt) + timeSuffix
  const endFmt = ({
    long:    'MMMM d',
    short:   'MMM d',
    compact: 'MMM d',
  }[style]) + year
  return `${format(start, startFmt)}${timeSuffix} → ${format(end!, endFmt)}`
}

/**
 * Build an ISO timestamp from an EO_* date column ('YYYY-MM-DD') and a
 * time column ('HH:MM:SS'). PostgREST serializes both as strings.
 * Defaults to midnight when the time is null or empty.
 */
function toIso(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null
  const t = time && time.trim() ? time.trim() : '00:00:00'
  return new Date(`${date}T${t}`).toISOString()
}

/**
 * Normalize a PostgREST time string ('HH:MM:SS' / 'HH:MM' or empty —
 * legacy Bubble values were 'HH:MM:SS.SSS', still tolerated) to 'HH:mm'
 * for display. Returns null when no time was set so surfaces can fall
 * back to date-only.
 */
function toHhmm(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function diveToEvent(d: EODive, priceIndex: Map<string, EOPrice>, addonIds: string[], roomIds: string[]): AppEvent | null {
  const start = toIso(d.start_date, d.time)
  if (!start) return null
  const p = d.price ? priceIndex.get(d.price) : undefined
  const gearText = d.gear_rental && d.gear_rental.trim() ? d.gear_rental.trim() : null
  return {
    id: d._id,
    type: 'dive',
    title: d.display_title || d.admin_title || 'Dive',
    calendar_title: d.calendar_title ?? null,
    start_time: start,
    end_time: toIso(d.end_date, d.time),
    start_time_hhmm: toHhmm(d.time),
    featured: d.featured ?? false,
    fully_booked: d.fully_booked ?? false,
    capacity: d.capacity ?? null,
    confirmed_count: null,
    price: p?.starting_at ?? null,
    deposit_amount: p?.deposit_amount ?? null,
    transport_price: p?.transport ?? null,
    currency: 'TWD',
    has_rooms: Boolean(d.has_rooms),
    room_type_ids: roomIds,
    has_addons: addonIds.length > 0,
    addon_ids: addonIds,
    gear_rental_info: gearText,
    nitrox_required: d.nitrox_required ?? false,
    dive_days: d.dive_days ?? null,
    cancelled_at: d.cancelled_at ?? null,
    full_payment_deadline: d.full_payment_deadline ?? null,
    cancel_policy: d.cancel_policy ?? null,
    cancel_date: d.cancel_date ?? null,
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
function courseToEvents(c: EOCourse, priceIndex: Map<string, EOPrice>, addonIds: string[]): AppEvent[] {
  const startKey = toDateKey(c.start_date)
  if (!startKey) return []
  const endKey = toDateKey(c.end_date) || startKey
  const specialKey = toDateKey((c as EOCourse & { special_date?: string | null }).special_date ?? null)

  const p = c.price ? priceIndex.get(c.price) : undefined
  const shared = {
    id: c._id,
    type: 'course' as const,
    title: c.display_title || c.admin_title || 'Course',
    calendar_title: c.calendar_title ?? null,
    start_time_hhmm: toHhmm(c.start_time),
    featured: false,
    fully_booked: c.fully_booked ?? false,
    capacity: c.capacity ?? null,
    confirmed_count: null,
    price: p?.starting_at ?? null,
    deposit_amount: p?.deposit_amount ?? null,
    transport_price: p?.transport ?? null,
    currency: 'TWD',
    has_rooms: false,
    room_type_ids: [] as string[],
    has_addons: addonIds.length > 0,
    addon_ids: addonIds,
    gear_rental_info: null,
    nitrox_required: false,
    dive_days: c.dive_days ?? null,
    cancelled_at: c.cancelled_at ?? null,
    full_payment_deadline: c.full_payment_deadline ?? null,
    cancel_policy: c.cancel_policy ?? null,
    cancel_date: c.cancel_date ?? null,
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

/**
 * Fetch addon links for a batch of dives + courses from the junction tables
 * (replacing the legacy JSON-array-of-IDs parse on `other_addons`).
 * Returns a map keyed by dive/course `_id` → ordered list of addon IDs.
 */
/**
 * Same shape as attachAddonIds but for the `eo_dive_rooms` junction table
 * (kept in sync from EO_dives.room_types CSV by the sync_eo_dive_rooms
 * trigger). Courses don't carry rooms, so this is dive-only.
 */
async function attachRoomIds(diveIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!diveIds.length) return out
  const { data } = await supabase
    .from('eo_dive_rooms')
    .select('eo_dive_id, room_id')
    .in('eo_dive_id', diveIds)
  for (const row of data ?? []) {
    const arr = out.get(row.eo_dive_id) ?? []
    arr.push(row.room_id)
    out.set(row.eo_dive_id, arr)
  }
  return out
}

async function attachAddonIds(diveIds: string[], courseIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (diveIds.length) {
    const { data } = await supabase
      .from('eo_dive_addons')
      .select('eo_dive_id, addon_id')
      .in('eo_dive_id', diveIds)
    for (const row of data ?? []) {
      const arr = out.get(row.eo_dive_id) ?? []
      arr.push(row.addon_id)
      out.set(row.eo_dive_id, arr)
    }
  }
  if (courseIds.length) {
    const { data } = await supabase
      .from('eo_course_addons')
      .select('eo_course_id, addon_id')
      .in('eo_course_id', courseIds)
    for (const row of data ?? []) {
      const arr = out.get(row.eo_course_id) ?? []
      arr.push(row.addon_id)
      out.set(row.eo_course_id, arr)
    }
  }
  return out
}

async function attachPrices(dives: EODive[], courses: EOCourse[]): Promise<Map<string, EOPrice>> {
  const priceIds = [
    ...dives.map(d => d.price),
    ...courses.map(c => c.price),
  ].filter((x): x is string => !!x)

  if (!priceIds.length) return new Map()

  const { data } = await supabase
    .from('EO_prices')
    .select('_id, admin_title, starting_at, deposit_amount, transport')
    .in('_id', [...new Set(priceIds)])

  return new Map((data ?? []).map(p => [p._id, p as EOPrice]))
}

const DIVE_COLS = '_id, admin_title, display_title, calendar_title, start_date, time, end_date, featured, fully_booked, capacity, price, has_rooms, room_types, hasotheraddons, other_addons, gear_rental, nitrox_required, dive_days, cancelled_at, full_payment_deadline, cancel_policy, cancel_date'
const COURSE_COLS = '_id, admin_title, display_title, calendar_title, start_date, start_time, end_date, price, other_addons, dive_days, special_date, cancelled_at, full_payment_deadline, cancel_policy, cancel_date, fully_booked, capacity'

/**
 * Fetch dives + courses whose start_date falls within [fromDate, toDate]
 * (inclusive, 'YYYY-MM-DD'). Courses also match when their `special_date`
 * lands inside the window — the calendar emits a separate pill for that
 * day, and a course with start_date outside the window but special_date
 * inside it still needs to render so the staff-busy overlay can flag
 * conflicts on the special day. Events with `cancelled_at` set are
 * hidden — admin soft-cancellations vanish from the calendar / listing
 * surfaces. Use `fetchEventsForBookings` when bookings against cancelled
 * events still need to resolve their event details.
 */
export async function fetchEventsInRange(fromDate: string, toDate: string): Promise<AppEvent[]> {
  const [divesResp, coursesResp] = await Promise.all([
    supabase.from('EO_dives').select(DIVE_COLS).is('cancelled_at', null).gte('start_date', fromDate).lte('start_date', toDate).order('start_date'),
    supabase.from('EO_courses').select(COURSE_COLS).is('cancelled_at', null)
      .or(`and(start_date.gte.${fromDate},start_date.lte.${toDate}),and(special_date.gte.${fromDate},special_date.lte.${toDate})`)
      .order('start_date'),
  ])

  const dives = (divesResp.data ?? []) as EODive[]
  const courses = (coursesResp.data ?? []) as EOCourse[]
  const [prices, addons, rooms] = await Promise.all([
    attachPrices(dives, courses),
    attachAddonIds(dives.map(d => d._id), courses.map(c => c._id)),
    attachRoomIds(dives.map(d => d._id)),
  ])

  const events = [
    ...dives.map(d => diveToEvent(d, prices, addons.get(d._id) ?? [], rooms.get(d._id) ?? [])).filter((x): x is AppEvent => !!x),
    ...courses.flatMap(c => courseToEvents(c, prices, addons.get(c._id) ?? [])),
  ].sort((a, b) => a.start_time.localeCompare(b.start_time))
  await attachConfirmedCounts(events)
  return events
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
  const [prices, addons, rooms] = await Promise.all([
    attachPrices(dives, courses),
    attachAddonIds(dives.map(d => d._id), courses.map(c => c._id)),
    attachRoomIds(dives.map(d => d._id)),
  ])

  const out = new Map<string, AppEvent>()
  for (const d of dives) {
    const ev = diveToEvent(d, prices, addons.get(d._id) ?? [], rooms.get(d._id) ?? [])
    if (ev) out.set(ev.id, ev)
  }
  for (const c of courses) {
    // For per-booking lookups we want a single representative entry per course
    // that covers the FULL course span [start_date..end_date], not segs[0] —
    // which for special_date-split courses (Wix branches B/C/D) can collapse
    // to a single in-month day. Per-booking surfaces (staff-on-duty date
    // picker, span labels) need the full range, otherwise the picker's
    // min/max bound out the other half of the course.
    const segs = courseToEvents(c, prices, addons.get(c._id) ?? [])
    if (segs.length === 0) continue
    const startKey = toDateKey(c.start_date)
    const endKey = toDateKey(c.end_date) || startKey
    const fullStart = startKey ? toIso(startKey, c.start_time) : null
    out.set(segs[0].id, {
      ...segs[0],
      start_time: fullStart ?? segs[0].start_time,
      end_time: endKey ? toIso(endKey, c.start_time) : segs[0].end_time,
    })
  }
  await attachConfirmedCounts([...out.values()])
  return out
}

/**
 * Populate `event.confirmed_count` in place via the event_confirmed_counts
 * RPC (SECURITY DEFINER, so divers see real aggregates past RLS).
 *
 * Only events with `capacity != null` need a count — uncapped events ignore
 * the field. Events with no confirmed bookings get 0. Mutates the array.
 */
async function attachConfirmedCounts(events: AppEvent[]): Promise<void> {
  if (events.length === 0) return
  // Group by id with type, so duplicate course segments share one count.
  const diveIds:   string[] = []
  const courseIds: string[] = []
  for (const ev of events) {
    if (ev.type === 'dive')   diveIds.push(ev.id)
    else                       courseIds.push(ev.id)
  }
  const dedupDive   = [...new Set(diveIds)]
  const dedupCourse = [...new Set(courseIds)]
  if (dedupDive.length === 0 && dedupCourse.length === 0) return

  // Non-fatal: any failure (RPC not deployed yet, network blip, test mock
  // without rpc) leaves confirmed_count null so the UI falls back to "no
  // badge" instead of breaking the whole event fetch.
  type Row = { event_id: string; event_type: string; n: number }
  let rows: Row[] = []
  try {
    const res = await supabase.rpc('event_confirmed_counts', {
      p_dive_ids:   dedupDive,
      p_course_ids: dedupCourse,
    })
    if (res.error) return
    rows = (res.data ?? []) as Row[]
  } catch {
    return
  }

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(`${row.event_type}:${row.event_id}`, Number(row.n))
  }
  for (const ev of events) {
    ev.confirmed_count = counts.get(`${ev.type}:${ev.id}`) ?? 0
  }
}

/**
 * Spots-remaining for diver-facing UI. Returns null when the event has no
 * capacity set (uncapped) or no count has been loaded yet — callers should
 * render no badge in that case. Otherwise returns max(0, capacity - confirmed).
 */
export function eventSpotsRemaining(event: Pick<AppEvent, 'capacity' | 'confirmed_count'>): number | null {
  if (event.capacity == null) return null
  if (event.confirmed_count == null) return null
  return Math.max(0, event.capacity - event.confirmed_count)
}

/**
 * True when divers should be steered to the waitlist — either the admin
 * manually flipped fully_booked, or capacity is set and exhausted. Mirrors
 * what set_waitlisted_when_event_full() decides server-side.
 */
export function eventIsFull(event: Pick<AppEvent, 'fully_booked' | 'capacity' | 'confirmed_count'>): boolean {
  if (event.fully_booked) return true
  const remaining = eventSpotsRemaining(event)
  return remaining !== null && remaining === 0
}
