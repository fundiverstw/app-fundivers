import { parseIsoDate, addIsoDays } from './dates'

// Recurrence rules for a series of events, and the date arithmetic that expands
// one into occurrence dates.
//
// Deliberately pure and calendar-only. Every date here is a `YYYY-MM-DD` string
// because that is what the `events` date columns hold — a day as written on the
// slate, with no time and no zone. Doing this arithmetic on timestamps would
// reintroduce the UTC-drift bug lib/dates.ts exists to avoid.
//
// An occurrence is identified by its ANCHOR date, not by a whole event shape.
// The caller shifts an event's own dates by (occurrenceAnchor - templateAnchor)
// days, which is what lets one rule serve both temporal shapes: a dive moves
// start_date/end_date, a course moves every entry in course_days. Neither needs
// to know anything about recurrence.

export type RecurrenceFreq =
  /** Every `interval` days from the anchor. */
  | 'daily'
  /** The chosen weekdays, in every `interval`-th week from the anchor's week. */
  | 'weekly'
  /** The same weekday-in-month as the anchor, every `interval` months. */
  | 'monthly_weekday'

export const RECURRENCE_FREQS: RecurrenceFreq[] = ['daily', 'weekly', 'monthly_weekday']

/** ISO weekday numbering: 1 = Monday … 7 = Sunday. Matches date-fns' getISODay. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

/**
 * Which weekday-of-the-month the anchor is. 1..4 counts from the start;
 * -1 means "the last one", which is how a 5th Friday has to be expressed
 * (most months don't have one, so counting to 5 would skip them).
 */
export type MonthPosition = 1 | 2 | 3 | 4 | -1

export interface RecurrenceRule {
  freq: RecurrenceFreq
  /** Every N days / weeks / months. */
  interval: number
  /** `weekly` only: the weekdays the series runs on. */
  weekdays?: Weekday[]
  /** How many occurrences to produce, counting the anchor as the first. */
  count: number
}

/**
 * The most occurrences one action may create.
 *
 * These are real, diver-visible `events` rows with capacity, prices and waivers
 * — a slip in the count field must not spawn hundreds of them. A year of weekly
 * dives is 52, which is as far ahead as any shop schedules in one go.
 */
export const MAX_OCCURRENCES = 52
export const MAX_INTERVAL = 12

export interface RecurrenceProblem {
  field: 'interval' | 'count' | 'weekdays'
  message: string
}

/** Empty when the rule is safe to expand. */
export function validateRecurrence(rule: RecurrenceRule): RecurrenceProblem[] {
  const problems: RecurrenceProblem[] = []
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL) {
    problems.push({ field: 'interval', message: `Repeat every 1 to ${MAX_INTERVAL}.` })
  }
  if (!Number.isInteger(rule.count) || rule.count < 2 || rule.count > MAX_OCCURRENCES) {
    problems.push({ field: 'count', message: `Create between 2 and ${MAX_OCCURRENCES} occurrences.` })
  }
  if (rule.freq === 'weekly' && (!rule.weekdays || rule.weekdays.length === 0)) {
    problems.push({ field: 'weekdays', message: 'Pick at least one weekday.' })
  }
  return problems
}

/** ISO weekday (1=Mon..7=Sun) of a `YYYY-MM-DD` date. */
export function isoWeekday(iso: string): Weekday {
  const js = parseIsoDate(iso).getDay()
  return (js === 0 ? 7 : js) as Weekday
}

/** The Monday of the ISO week containing `iso`. */
function weekStart(iso: string): string {
  return addIsoDays(iso, -(isoWeekday(iso) - 1))
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate()
}

function isoOf(year: number, month1: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month1)}-${pad(day)}`
}

/**
 * The date of the `position`-th `weekday` in a month, or null when that month
 * has no such date (only reachable for position 4 in a 28-day February, and for
 * any caller asking for a 5th).
 */
export function nthWeekdayOfMonth(
  year: number, month1: number, weekday: Weekday, position: MonthPosition,
): string | null {
  const total = daysInMonth(year, month1)
  const matching: number[] = []
  for (let day = 1; day <= total; day++) {
    if (isoWeekday(isoOf(year, month1, day)) === weekday) matching.push(day)
  }
  const day = position === -1 ? matching[matching.length - 1] : matching[position - 1]
  return day ? isoOf(year, month1, day) : null
}

/**
 * Which weekday-of-the-month the anchor is, as a rule would express it.
 *
 * The LAST matching weekday reports as -1 rather than its ordinal, so "the last
 * Sunday" keeps meaning that in a month with only four of them. Without this a
 * 5th-weekday anchor would produce a rule that skips most months.
 */
export function monthPositionOf(iso: string): MonthPosition {
  const d = parseIsoDate(iso)
  const weekday = isoWeekday(iso)
  const last = nthWeekdayOfMonth(d.getFullYear(), d.getMonth() + 1, weekday, -1)
  if (last === iso) return -1
  const ordinal = Math.floor((d.getDate() - 1) / 7) + 1
  return Math.min(ordinal, 4) as MonthPosition
}

/**
 * The dates a rule produces, starting at `anchorIso`.
 *
 * The anchor is always the first occurrence: it is the event the admin is
 * actually filling in, so a pattern that excluded it would silently create a
 * series the template isn't part of. For `weekly` that means the anchor's own
 * weekday counts whether or not it was ticked — the form pre-selects and locks
 * it for the same reason.
 *
 * Returns at most `count` dates, and never more than MAX_OCCURRENCES.
 */
export function occurrenceDates(rule: RecurrenceRule, anchorIso: string): string[] {
  const count = Math.min(Math.max(rule.count, 1), MAX_OCCURRENCES)
  const interval = Math.max(rule.interval, 1)
  const out: string[] = [anchorIso]

  if (rule.freq === 'daily') {
    let cursor = anchorIso
    while (out.length < count) {
      cursor = addIsoDays(cursor, interval)
      out.push(cursor)
    }
    return out
  }

  if (rule.freq === 'weekly') {
    // The anchor's weekday is always in the set (see above), and the set is
    // walked in weekday order within each active week so the dates come out
    // ascending.
    const days = [...new Set([...(rule.weekdays ?? []), isoWeekday(anchorIso)])].sort((a, b) => a - b)
    const firstWeek = weekStart(anchorIso)
    for (let week = 0; out.length < count; week++) {
      const start = addIsoDays(firstWeek, week * interval * 7)
      for (const weekday of days) {
        if (out.length >= count) break
        const date = addIsoDays(start, weekday - 1)
        // Skip the anchor's own date (already first) and anything before it: a
        // Sat anchor with [Sat, Sun] must not reach back to that week's Sunday.
        if (date <= anchorIso) continue
        out.push(date)
      }
      // A pathological interval can't stall the loop: `start` always advances.
    }
    return out
  }

  const anchor = parseIsoDate(anchorIso)
  const weekday = isoWeekday(anchorIso)
  const position = monthPositionOf(anchorIso)
  let year = anchor.getFullYear()
  let month1 = anchor.getMonth() + 1
  // Bounded rather than "until we have enough": a month that cannot satisfy the
  // position is skipped, and an unbounded loop would spin forever if every
  // remaining month were skipped. The slack covers the skips.
  const maxMonths = (count + 1) * interval + 12
  for (let step = 0; step < maxMonths && out.length < count; step++) {
    month1 += interval
    while (month1 > 12) { month1 -= 12; year += 1 }
    const date = nthWeekdayOfMonth(year, month1, weekday, position)
    // Skipped, never nudged to a neighbouring week: the shop asked for a
    // specific weekday-in-month, and a dive silently moved by a week is worse
    // than one missing from the batch that they can add by hand.
    if (date) out.push(date)
  }
  return out
}

/**
 * The date the next occurrence after `lastIso` would fall on, for extending an
 * existing series. Same arithmetic, re-anchored — which is why the rule stores
 * no absolute dates of its own.
 */
export function datesAfter(rule: RecurrenceRule, lastIso: string, howMany: number): string[] {
  return occurrenceDates({ ...rule, count: howMany + 1 }, lastIso).slice(1)
}
