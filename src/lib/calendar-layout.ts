import { isAfter, isSameDay, startOfDay } from 'date-fns'
import type { AppEvent } from '../types/database'

// Minimum shape the layout helpers need from anything that wants to be
// stacked into tracks. AppEvent satisfies it; so does the synthetic
// "staff_busy" projection MonthCalendar builds for its overlay lane.
export interface LayoutEvent {
  id: string
  start_time: string
  end_time: string | null
}

export interface EventRange<T extends LayoutEvent = AppEvent> {
  event: T
  start: Date
  end: Date
  /** 0-based vertical track the bar occupies within each day cell. */
  track: number
}

export interface CellSegment<T extends LayoutEvent = AppEvent> {
  event: T
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
export function assignTracks<T extends LayoutEvent>(events: T[]): EventRange<T>[] {
  const ranges: EventRange<T>[] = events.map(event => ({
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
export function segmentsForDay<T extends LayoutEvent>(
  day: Date,
  ranges: EventRange<T>[],
  weekStart: Date,
  weekEnd: Date
): Map<number, CellSegment<T>> {
  const out = new Map<number, CellSegment<T>>()
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
