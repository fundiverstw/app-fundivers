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
