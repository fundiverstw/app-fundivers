import { format, isSameDay, parseISO } from 'date-fns'
import { supabase } from './supabase'
import { diveOutingFromDestinations, type DiveOuting } from './event-colors'
import { siteConfig } from '../config/site'
import type { AppEvent, EventDetails, EventRow, EOPrice } from '../types/database'

type TripTemplateDetail = {
  id: string
  included: string | null
  not_included: string | null
  transportation: string | null
  itinerary: string | null
  prerequisites: string | null
}

// Descriptive columns that drive the event-detail modal. Fetched separately
// and best-effort (see attachEventDetails) so a drifted/missing column never
// breaks the calendar's core event query.
type EventDetailRow = {
  id: string
  kind: 'dive' | 'course'
  notes: string | null
  prereqs: string | null
  req_dives: number | null
  trip_template_id: string | null
  prereq_cert_id: string | null
  included: string | null
  schedule: string | null
}

function cleanText(s: string | null | undefined): string | null {
  return s && s.trim() ? s.trim() : null
}

/** Drop an EventDetails to null when it carries no content at all, so the
 *  calendar modal can gate the whole section on a single truthy check. */
function nonEmptyDetails(d: EventDetails): EventDetails | null {
  const hasContent =
    d.description || d.included || d.not_included || d.schedule ||
    d.transportation || d.prerequisites || d.required_cert || d.required_dives != null
  return hasContent ? d : null
}

function diveDetails(d: EventDetailRow, travel: TripTemplateDetail | null, requiredCert: string | null): EventDetails | null {
  return nonEmptyDetails({
    description: cleanText(d.notes),
    included: cleanText(travel?.included),
    not_included: cleanText(travel?.not_included),
    schedule: cleanText(travel?.itinerary),
    transportation: cleanText(travel?.transportation),
    prerequisites: cleanText(d.prereqs) ?? cleanText(travel?.prerequisites),
    required_cert: requiredCert,
    required_dives: d.req_dives ?? null,
  })
}

function courseDetails(c: EventDetailRow, requiredCert: string | null): EventDetails | null {
  return nonEmptyDetails({
    description: null,
    included: cleanText(c.included),
    not_included: null,
    schedule: cleanText(c.schedule),
    transportation: null,
    prerequisites: cleanText(c.prereqs),
    required_cert: requiredCert,
    required_dives: c.req_dives ?? null,
  })
}

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
 * True when an event's last day is before today in the shop's timezone
 * — i.e. the event has already happened. Used to close
 * registration to divers for past events (admins/staff bypass this). Compared
 * by calendar day, not instant, so a diver can still register the morning of.
 */
export function isPastEvent(
  event: Pick<AppEvent, 'start_time' | 'end_time'>,
  now: Date = new Date(),
): boolean {
  const dayKey = (d: Date | string) =>
    new Date(d).toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone })
  return dayKey(event.end_time ?? event.start_time) < dayKey(now)
}

/**
 * Build an ISO timestamp from a date column ('YYYY-MM-DD') and a time column
 * ('HH:MM:SS'). PostgREST serializes both as strings. Defaults to midnight when
 * the time is null or empty.
 */
function toIso(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null
  const t = time && time.trim() ? time.trim() : '00:00:00'
  return new Date(`${date}T${t}`).toISOString()
}

/**
 * Normalize a PostgREST time string ('HH:MM:SS' / 'HH:MM' or empty) to 'HH:mm'
 * for display. Returns null when no time was set so surfaces can fall back to
 * date-only.
 */
function toHhmm(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function diveToEvent(e: EventRow, priceIndex: Map<string, EOPrice>, addonIds: string[], roomIds: string[], outing: DiveOuting | null, details: EventDetails | null): AppEvent | null {
  const start = toIso(e.start_date, e.start_time)
  if (!start) return null
  const p = e.price ? priceIndex.get(e.price) : undefined
  const gearText = e.gear_rental && e.gear_rental.trim() ? e.gear_rental.trim() : null
  return {
    id: e.id,
    type: 'dive',
    title: e.display_title || e.admin_title || 'Dive',
    calendar_title: e.calendar_title ?? null,
    start_time: start,
    end_time: toIso(e.end_date, e.start_time),
    start_time_hhmm: toHhmm(e.start_time),
    featured: e.featured ?? false,
    featured_image: e.featured_image ?? null,
    fully_booked: e.fully_booked ?? false,
    capacity: e.capacity ?? null,
    confirmed_count: null,
    price: p?.starting_at ?? null,
    deposit_amount: p?.deposit_amount ?? null,
    transport_price: p?.transport ?? null,
    currency: siteConfig.locale.currency,
    has_rooms: roomIds.length > 0,
    room_type_ids: roomIds,
    has_addons: addonIds.length > 0,
    addon_ids: addonIds,
    gear_rental_info: gearText,
    nitrox_required: e.nitrox_required ?? false,
    dive_days: e.dive_days ?? null,
    cancelled_at: e.cancelled_at ?? null,
    is_private: e.is_private ?? false,
    is_boat_dive: e.is_boat_dive ?? false,
    is_trip: e.is_trip ?? false,
    full_payment_deadline: e.full_payment_deadline ?? null,
    cancel_policy: e.cancel_policy ?? null,
    cancel_date: e.cancel_date ?? null,
    dive_outing: outing,
    details,
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
 * Sort + dedupe a course's day list and group adjacent dates into
 * continuous runs. Returns runs as [firstKey, lastKey] pairs, in order.
 * A single day is its own run; consecutive calendar days merge into one.
 */
function groupConsecutive(dayKeys: string[]): [string, string][] {
  const sorted = [...new Set(dayKeys)].sort()
  const runs: [string, string][] = []
  for (const key of sorted) {
    const last = runs[runs.length - 1]
    if (last && dayDiff(last[1], key) === 1) last[1] = key
    else runs.push([key, key])
  }
  return runs
}

/**
 * A course runs on an explicit list of days (`course_days`, max 4). Adjacent
 * days render as one continuous bar — exactly like a multi-day dive's
 * start_date..end_date range — while gaps render as separate pills. We emit one
 * segment per run of consecutive days. All returned segments share the event
 * `id`. A course with no course_days (malformed row) renders nothing.
 */
function courseToEvents(c: EventRow, priceIndex: Map<string, EOPrice>, addonIds: string[], details: EventDetails | null): AppEvent[] {
  const dayKeys = (c.course_days ?? [])
    .map(toDateKey)
    .filter((k): k is string => !!k)
  if (dayKeys.length === 0) return []

  const p = c.price ? priceIndex.get(c.price) : undefined
  const shared = {
    id: c.id,
    type: 'course' as const,
    title: c.display_title || c.admin_title || 'Course',
    calendar_title: c.calendar_title ?? null,
    course_category: c.admin_title ?? null,
    start_time_hhmm: toHhmm(c.start_time),
    featured: false,
    featured_image: c.featured_image ?? null,
    fully_booked: c.fully_booked ?? false,
    capacity: c.capacity ?? null,
    confirmed_count: null,
    price: p?.starting_at ?? null,
    deposit_amount: p?.deposit_amount ?? null,
    transport_price: p?.transport ?? null,
    currency: siteConfig.locale.currency,
    has_rooms: false,
    room_type_ids: [] as string[],
    has_addons: addonIds.length > 0,
    addon_ids: addonIds,
    gear_rental_info: null,
    nitrox_required: false,
    dive_days: c.dive_days ?? null,
    cancelled_at: c.cancelled_at ?? null,
    is_private: false,
    full_payment_deadline: c.full_payment_deadline ?? null,
    cancel_policy: c.cancel_policy ?? null,
    cancel_date: c.cancel_date ?? null,
    details,
  }

  const makeSegment = (fromKey: string, toKey: string): AppEvent | null => {
    const start = toIso(fromKey, c.start_time)
    if (!start) return null
    const end = toIso(toKey, c.start_time)
    return { ...shared, start_time: start, end_time: end }
  }

  return groupConsecutive(dayKeys)
    .map(([from, to]) => makeSegment(from, to))
    .filter((x): x is AppEvent => !!x)
}

/** Build the AppEvent(s) for a row: one for a dive, one-per-run for a course. */
function rowToEvents(e: EventRow, priceIndex: Map<string, EOPrice>, addonIds: string[], roomIds: string[], outing: DiveOuting | null, details: EventDetails | null): AppEvent[] {
  if (e.kind === 'course') return courseToEvents(e, priceIndex, addonIds, details)
  const ev = diveToEvent(e, priceIndex, addonIds, roomIds, outing, details)
  return ev ? [ev] : []
}

/** addon links for a batch of events, keyed by event id. */
async function attachAddonIds(eventIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!eventIds.length) return out
  const { data } = await supabase
    .from('event_addons')
    .select('event_id, addon_id')
    .in('event_id', eventIds)
  for (const row of data ?? []) {
    const arr = out.get(row.event_id) ?? []
    arr.push(row.addon_id)
    out.set(row.event_id, arr)
  }
  return out
}

/** room links for a batch of events, keyed by event id. */
async function attachRoomIds(eventIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (!eventIds.length) return out
  const { data } = await supabase
    .from('event_rooms')
    .select('event_id, room_id')
    .in('event_id', eventIds)
  for (const row of data ?? []) {
    const arr = out.get(row.event_id) ?? []
    arr.push(row.room_id)
    out.set(row.event_id, arr)
  }
  return out
}

/**
 * Resolve each event's calendar color bucket ('local' | 'trip') from its linked
 * destinations. Two explicit queries (junction, then the destination rows).
 * Events with no destination tagged are absent from the map.
 */
async function attachDiveOutings(eventIds: string[]): Promise<Map<string, DiveOuting>> {
  const out = new Map<string, DiveOuting>()
  if (!eventIds.length) return out
  const { data: links } = await supabase
    .from('event_destinations')
    .select('event_id, destination_id')
    .in('event_id', eventIds)
  if (!links?.length) return out

  const destIds = [...new Set(links.map(l => l.destination_id))]
  const { data: dests } = await supabase
    .from('travel_destinations')
    .select('id, divetype')
    .in('id', destIds)
  const destById = new Map((dests ?? []).map(d => [d.id, d]))

  const byEvent = new Map<string, Array<{ divetype: string | null }>>()
  for (const l of links) {
    const d = destById.get(l.destination_id)
    if (!d) continue
    const arr = byEvent.get(l.event_id) ?? []
    arr.push({ divetype: d.divetype })
    byEvent.set(l.event_id, arr)
  }
  for (const [id, ds] of byEvent) {
    const o = diveOutingFromDestinations(ds)
    if (o) out.set(id, o)
  }
  return out
}

/**
 * Fetch the trip_templates rows referenced by a batch of events (via
 * events.trip_template_id, a single id). Returns a map keyed by trip_templates.id.
 */
async function attachTripTemplate(refs: Array<string | null>): Promise<Map<string, TripTemplateDetail>> {
  const out = new Map<string, TripTemplateDetail>()
  const ids = [...new Set(refs.filter((x): x is string => !!x))]
  if (!ids.length) return out
  const { data } = await supabase
    .from('trip_templates')
    .select('id, included, not_included, transportation, itinerary, prerequisites')
    .in('id', ids)
  for (const row of data ?? []) out.set(row.id, row as TripTemplateDetail)
  return out
}

/**
 * Resolve `prereq_cert_id` (→ cert_levels.id) to the level's display name for a
 * batch of events. Returns a map keyed by cert_levels.id.
 */
async function attachCertNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const certIds = [...new Set(ids.filter((x): x is string => !!x))]
  if (!certIds.length) return out
  const { data } = await supabase
    .from('cert_levels')
    .select('id, name')
    .in('id', certIds)
  for (const row of data ?? []) if (row.name) out.set(row.id, row.name)
  return out
}

/**
 * Run a detail-column select that tolerates schema drift: when PostgREST
 * rejects a single column with 42703, drop just that column and retry.
 */
async function selectDetailCols<T>(columns: string[], ids: string[]): Promise<T[]> {
  let cols = [...columns]
  while (cols.length > 1) {
    const { data, error } = await supabase.from('events').select(cols.join(', ')).in('id', ids)
    if (!error) return (data ?? []) as T[]
    if (error.code !== '42703') return []
    const missing = error.message.match(/column \S+\.(\w+) does not exist/)?.[1]
    if (!missing || missing === 'id' || missing === 'kind') return []
    cols = cols.filter(c => c !== missing)
  }
  return []
}

/**
 * Best-effort fetch of the descriptive detail columns for a batch of events,
 * returning a map of event id → EventDetails. Kept separate from the core event
 * query and drift-tolerant per column so a missing column degrades to a thinner
 * detail rather than none.
 */
async function attachEventDetails(eventIds: string[]): Promise<Map<string, EventDetails>> {
  const out = new Map<string, EventDetails>()
  if (!eventIds.length) return out

  const rows = await selectDetailCols<EventDetailRow>(
    ['id', 'kind', 'notes', 'prereqs', 'req_dives', 'trip_template_id', 'prereq_cert_id', 'included', 'schedule'],
    eventIds,
  )
  if (!rows.length) return out

  const [travel, certNames] = await Promise.all([
    attachTripTemplate(rows.map(r => r.trip_template_id)),
    attachCertNames(rows.map(r => r.prereq_cert_id)),
  ])

  for (const r of rows) {
    const cert = r.prereq_cert_id ? certNames.get(r.prereq_cert_id) ?? null : null
    const det = r.kind === 'course'
      ? courseDetails(r, cert)
      : diveDetails(r, r.trip_template_id ? travel.get(r.trip_template_id) ?? null : null, cert)
    if (det) out.set(r.id, det)
  }
  return out
}

async function attachPrices(events: EventRow[]): Promise<Map<string, EOPrice>> {
  const priceIds = events.map(e => e.price).filter((x): x is string => !!x)
  if (!priceIds.length) return new Map()
  const { data } = await supabase
    .from('prices')
    .select('id, admin_title, starting_at, deposit_amount, transport')
    .in('id', [...new Set(priceIds)])
  return new Map((data ?? []).map(p => [p.id, p as EOPrice]))
}

// Core columns only — the descriptive detail columns are fetched best-effort by
// attachEventDetails so schema drift can't break the calendar.
const EVENT_COLS = 'id, kind, admin_title, display_title, calendar_title, start_date, start_time, end_date, course_days, featured, featured_image, fully_booked, capacity, price, gear_rental, nitrox_required, dive_days, cancelled_at, full_payment_deadline, cancel_policy, cancel_date, is_private, is_boat_dive, is_trip'

// Every 'YYYY-MM-DD' from `fromDate` to `toDate` inclusive. Used to ask
// PostgREST for courses whose course_days array shares at least one day
// with the window (`&&` overlap), since there's no scalar envelope on courses.
function datesInRange(fromDate: string, toDate: string): string[] {
  const out: string[] = []
  const end = new Date(toDate + 'T00:00:00Z')
  for (let d = new Date(fromDate + 'T00:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

async function enrichAndBuild(rows: EventRow[]): Promise<AppEvent[]> {
  const ids = rows.map(e => e.id)
  const [prices, addons, rooms, outings, details] = await Promise.all([
    attachPrices(rows),
    attachAddonIds(ids),
    attachRoomIds(ids),
    attachDiveOutings(ids),
    attachEventDetails(ids),
  ])
  return rows.flatMap(e => rowToEvents(e, prices, addons.get(e.id) ?? [], rooms.get(e.id) ?? [], outings.get(e.id) ?? null, details.get(e.id) ?? null))
}

/**
 * Fetch dives whose start_date falls within [fromDate, toDate] plus courses
 * with at least one session day inside the window (inclusive). Dives and courses
 * are one table now (kind), but keep the two date-model queries: dives match a
 * scalar start_date range, courses match by overlapping `course_days`.
 * Cancelled events are hidden.
 */
export async function fetchEventsInRange(
  fromDate: string,
  toDate: string,
  opts: { includePrivate?: boolean } = {},
): Promise<AppEvent[]> {
  let diveQuery = supabase.from('events').select(EVENT_COLS).eq('kind', 'dive').is('cancelled_at', null)
    .gte('start_date', fromDate).lte('start_date', toDate).order('start_date')
  if (!opts.includePrivate) diveQuery = diveQuery.eq('is_private', false)
  const [divesResp, coursesResp] = await Promise.all([
    diveQuery,
    supabase.from('events').select(EVENT_COLS).eq('kind', 'course').is('cancelled_at', null)
      .overlaps('course_days', datesInRange(fromDate, toDate)),
  ])

  const rows = [...((divesResp.data ?? []) as EventRow[]), ...((coursesResp.data ?? []) as EventRow[])]
  const events = (await enrichAndBuild(rows)).sort((a, b) => a.start_time.localeCompare(b.start_time))
  await attachConfirmedCounts(events)
  return events
}

/**
 * Distinct 'YYYY-MM-DD' days in [fromDate, toDate] with at least one
 * non-cancelled event — dive `start_date` and course `course_days`. Powers the
 * "Other day" picker. Private dives are included (admin-only surface).
 */
export async function fetchUpcomingEventDays(
  fromDate: string,
  toDate: string,
): Promise<string[]> {
  const [divesResp, coursesResp] = await Promise.all([
    supabase.from('events').select('start_date').eq('kind', 'dive').is('cancelled_at', null)
      .gte('start_date', fromDate).lte('start_date', toDate),
    supabase.from('events').select('course_days').eq('kind', 'course').is('cancelled_at', null)
      .overlaps('course_days', datesInRange(fromDate, toDate)),
  ])
  const days = new Set<string>()
  for (const d of (divesResp.data ?? []) as { start_date: string | null }[]) {
    if (d.start_date) days.add(d.start_date)
  }
  for (const c of (coursesResp.data ?? []) as { course_days: string[] | null }[]) {
    for (const day of c.course_days ?? []) {
      if (day >= fromDate && day <= toDate) days.add(day)
    }
  }
  return [...days].sort()
}

/** Fetch the events referenced by a batch of bookings, keyed by event id. */
export async function fetchEventsForBookings(eventIds: string[]): Promise<Map<string, AppEvent>> {
  const ids = [...new Set(eventIds.filter(Boolean))]
  if (!ids.length) return new Map()
  const { data } = await supabase.from('events').select(EVENT_COLS).in('id', ids)
  const rows = (data ?? []) as EventRow[]
  const ordered = rows.map(e => e.id)

  const [prices, addons, rooms, outings, details] = await Promise.all([
    attachPrices(rows),
    attachAddonIds(ordered),
    attachRoomIds(ordered),
    attachDiveOutings(ordered),
    attachEventDetails(ordered),
  ])

  const out = new Map<string, AppEvent>()
  for (const e of rows) {
    if (e.kind === 'dive') {
      const ev = diveToEvent(e, prices, addons.get(e.id) ?? [], rooms.get(e.id) ?? [], outings.get(e.id) ?? null, details.get(e.id) ?? null)
      if (ev) out.set(ev.id, ev)
      continue
    }
    // For per-booking lookups we want ONE representative course entry covering
    // the FULL span — first..last day — not segs[0], which collapses to the
    // first run of consecutive days.
    const segs = courseToEvents(e, prices, addons.get(e.id) ?? [], details.get(e.id) ?? null)
    if (segs.length === 0) continue
    const dayKeys = (e.course_days ?? []).map(toDateKey).filter((k): k is string => !!k)
    const earliest = dayKeys.length ? dayKeys.reduce((a, b) => a < b ? a : b) : null
    const latest = dayKeys.length ? dayKeys.reduce((a, b) => a > b ? a : b) : null
    out.set(segs[0].id, {
      ...segs[0],
      start_time: earliest ? toIso(earliest, e.start_time) ?? segs[0].start_time : segs[0].start_time,
      end_time: latest ? toIso(latest, e.start_time) : segs[0].end_time,
    })
  }
  await attachConfirmedCounts([...out.values()])
  return out
}

/**
 * Populate `event.confirmed_count` in place via the event_confirmed_counts RPC
 * (SECURITY DEFINER, so divers see real aggregates past RLS). Only events with
 * `capacity != null` need a count; events with no confirmed bookings get 0.
 */
async function attachConfirmedCounts(events: AppEvent[]): Promise<void> {
  if (events.length === 0) return
  const ids = [...new Set(events.map(ev => ev.id))]
  if (ids.length === 0) return

  // Non-fatal: any failure (RPC missing, network blip, test mock without rpc)
  // leaves confirmed_count null so the UI falls back to no badge.
  type Row = { event_id: string; n: number }
  let rows: Row[]
  try {
    const res = await supabase.rpc('event_confirmed_counts', { p_event_ids: ids })
    if (res.error) return
    rows = (res.data ?? []) as Row[]
  } catch {
    return
  }

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.event_id, Number(row.n))
  for (const ev of events) ev.confirmed_count = counts.get(ev.id) ?? 0
}

/**
 * Spots-remaining for diver-facing UI. Returns null when the event has no
 * capacity set (uncapped) or no count has been loaded yet. Otherwise returns
 * max(0, capacity - confirmed).
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
