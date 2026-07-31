// Date helpers shared across pages so the same formatting isn't reimplemented
// per-call-site.
//
// A `date` column holds a calendar date with no time and no zone — the day the
// dive happened, as written on the slate. Two conversions get that wrong in
// ways that only show up in some timezones:
//
//   - `new Date().toISOString().slice(0,10)` is *UTC's* today, not the shop's.
//     East of UTC it reads as yesterday for the first hours of every day.
//   - `new Date('2026-04-30')` parses as UTC midnight, so rendering it in a
//     timezone behind UTC shows the 29th.
//
// Use `todayIso` and `parseIsoDate` for date columns; `isoDate` stays for the
// callers that genuinely want a UTC slice of a specific instant.

import { format } from 'date-fns'
import { siteConfig } from '../config/site'

/** A Date as a `YYYY-MM-DD` calendar string (UTC), for Supabase date columns. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Today's calendar date in the shop's timezone, as `YYYY-MM-DD`.
 *
 * `en-CA` is the locale whose short date format already *is* ISO order, so
 * this needs no reassembly.
 */
export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone })
}

/**
 * Read a `YYYY-MM-DD` column value back as a Date positioned at local
 * midnight, so formatting it renders the day that was stored rather than
 * whatever UTC midnight lands on in the reader's timezone.
 */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Shift a `YYYY-MM-DD` by whole days, staying in calendar space. */
export function addIsoDays(iso: string, days: number): string {
  const d = parseIsoDate(iso)
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * A Date whose LOCAL fields carry the shop-timezone wall clock of `instant`.
 *
 * date-fns `format` reads a Date's LOCAL fields, so it renders every instant in
 * whatever timezone the browser happens to sit in — a diver in London sees a
 * Taipei event's date and time shifted onto their own clock. Feeding `format`
 * this shifted Date instead makes it render the shop's wall clock everywhere.
 *
 * The result is a fiction — its absolute instant is wrong by the zone offset —
 * so it is ONLY safe to hand to a formatter. Never do arithmetic on it, and
 * never store or compare it as an instant.
 *
 * Caveat: the shop wall clock is rebuilt via the runtime-local Date
 * constructor, so a viewer in a DST-observing zone whose local spring-forward
 * gap coincides with the shop time can see an HH:mm an hour off. Date-only
 * formats are unaffected, and the shop zone this app targets (Asia/Taipei) has
 * no DST.
 *
 * An unparseable Date is returned untouched so the caller's `format` throws
 * (or its NaN guard fires) exactly as it did before this indirection.
 */
export function shopZoned(instant: Date): Date {
  if (Number.isNaN(instant.getTime())) return instant
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: siteConfig.locale.timezone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const p: Record<string, string> = {}
  for (const part of parts) p[part.type] = part.value
  // hourCycle h23 can emit '24' for midnight on some engines; fold it to 0.
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
}

/**
 * Render a `timestamptz` (or Date) with a date-fns format string, in the shop's
 * timezone. The one entry point for timestamp display so no call site has to
 * remember to shop-zone first. Returns null when the value can't be parsed.
 *
 * date-fns `format` throws "Invalid time value" on a bad string, and these
 * timestamps are one line inside a much larger admin card — a malformed one
 * must not take the whole card down with it. Null lets the caller drop the
 * line instead.
 *
 * For a `date` COLUMN use parseIsoDate first: this parses as an instant, which
 * is right for timestamps and a day out for calendar dates.
 */
export function formatTimestamp(iso: string | Date | null | undefined, fmt: string): string | null {
  if (!iso) return null
  const d = iso instanceof Date ? iso : new Date(iso)
  return Number.isNaN(d.getTime()) ? null : format(shopZoned(d), fmt)
}

/** A `timestamptz` rendered as "Jul 30, 2026" in the shop's timezone, or null. */
export function formatTimestampDay(iso: string | null | undefined): string | null {
  return formatTimestamp(iso, 'MMM d, yyyy')
}

/**
 * Whole calendar days from `from` to `to` (negative when `to` is earlier).
 *
 * Computed in UTC on purpose. The local-midnight arithmetic used elsewhere in
 * this module is right for RENDERING a calendar date, but subtracting two local
 * midnights across a DST boundary yields 23 or 25 hours and a fractional day
 * count. Date.UTC has no such boundaries, and the difference between two
 * calendar dates doesn't depend on a timezone anyway.
 */
export function diffIsoDays(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}
