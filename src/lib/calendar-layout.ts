import { differenceInCalendarDays, isAfter, isSameDay, isSameMonth, startOfDay } from 'date-fns'
import type { AppEvent } from '../types/database'

export interface EventRange {
  event: AppEvent
  start: Date
  end: Date
  /** 0-based vertical track the bar occupies within each day cell. */
  track: number
}

export interface CellSegment {
  event: AppEvent
  track: number
  /** This cell is the left edge of the bar (either the event start, or the first day of its week). */
  isStart: boolean
  /** This cell is the right edge (either the event end, or the last day of its week). */
  isEnd: boolean
  /** True only on the cell that should render the title (start of event, or start of each new week it spans). */
  showTitle: boolean
}

/**
 * Assign each event to the lowest track that doesn't overlap any prior event.
 * Events are sorted ascending by start date (with ties broken by longer duration
 * first so the longer bar gets the lower track).
 */
export function assignTracks(events: AppEvent[]): EventRange[] {
  const ranges: EventRange[] = events.map(event => ({
    event,
    start: startOfDay(new Date(event.start_time)),
    end: startOfDay(new Date(event.end_time ?? event.start_time)),
    track: 0,
  }))
  ranges.sort((a, b) => {
    const s = a.start.getTime() - b.start.getTime()
    if (s !== 0) return s
    // Longer first when they start on the same day
    return (b.end.getTime() - b.start.getTime()) - (a.end.getTime() - a.start.getTime())
  })

  const trackEnds: Date[] = []
  for (const r of ranges) {
    let t = 0
    while (t < trackEnds.length && !isAfter(r.start, trackEnds[t])) t++
    r.track = t
    trackEnds[t] = r.end
  }
  return ranges
}

/**
 * For a given day, return a map track → segment. Only includes tracks that
 * actually have an event on this day. `weekStart` + `weekEnd` are used to
 * decide when the bar should "reset" (rounded edge + title re-shown on the
 * first cell of each new week it spans).
 */
export function segmentsForDay(
  day: Date,
  ranges: EventRange[],
  weekStart: Date,
  weekEnd: Date
): Map<number, CellSegment> {
  const out = new Map<number, CellSegment>()
  const d = startOfDay(day)
  for (const r of ranges) {
    if (d < r.start || d > r.end) continue
    const isEventStart = isSameDay(d, r.start)
    const isEventEnd = isSameDay(d, r.end)
    const isWeekStart = isSameDay(d, weekStart)
    const isWeekEnd = isSameDay(d, weekEnd)
    out.set(r.track, {
      event: r.event,
      track: r.track,
      isStart: isEventStart || isWeekStart,
      isEnd: isEventEnd || isWeekEnd,
      showTitle: isEventStart || isWeekStart,
    })
  }
  return out
}

/** Number of vertical tracks needed for the given month (upper bound across cells). */
export function maxTracksInRange(ranges: EventRange[], monthStart: Date, monthEnd: Date): number {
  let max = 0
  for (const r of ranges) {
    if (r.end < monthStart || r.start > monthEnd) continue
    if (r.track + 1 > max) max = r.track + 1
  }
  return max
}

/** Keep only ranges that touch the given month (so we don't waste tracks on out-of-scope events). */
export function rangesIntersectingMonth(ranges: EventRange[], month: Date): EventRange[] {
  return ranges.filter(r => isSameMonth(r.start, month) || isSameMonth(r.end, month)
    || (r.start < month && r.end > month))
}

export function daysBetween(a: Date, b: Date) {
  return Math.abs(differenceInCalendarDays(a, b))
}
