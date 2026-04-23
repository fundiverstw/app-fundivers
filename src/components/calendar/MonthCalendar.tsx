import { useEffect, useMemo, useRef, useState } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth,
  addMonths, subMonths, startOfWeek, endOfWeek,
} from 'date-fns'
import { assignTracks, segmentsForDay, type CellSegment, type EventRange } from '../../lib/calendar-layout'
import { formatEventSpan } from '../../lib/events'
import type { AppEvent } from '../../types/database'

// Shared by CalendarPage (diver) and AdminEventsPage (admin). The only
// differences between those two surfaces are what happens when you pick an
// event, and what gets rendered in the "this month" list items — both
// expressed as props here so the grid + filter legend stay one copy.

const TYPE_BAR: Record<AppEvent['type'], string> = {
  dive:   'bg-sky-500 hover:bg-sky-400 text-white',
  course: 'bg-emerald-500 hover:bg-emerald-400 text-white',
}
const TYPE_DOT: Record<AppEvent['type'], string> = {
  dive:   'bg-sky-500',
  course: 'bg-emerald-500',
}
const TYPE_LABELS: Record<AppEvent['type'], string> = {
  dive:   'Dive',
  course: 'Course',
}

// Short chip labels for the course-category filter popover.
const COURSE_SHORT: Record<string, string> = {
  'Open Water Course':   'OW',
  'Advanced Open Water': 'AOW',
  'PADI Rescue Course':  'Rescue',
  'EFR Course':          'EFR',
  'Equipment Course':    'Equipment',
  'Deep Specialty':      'Deep',
}
function courseShortLabel(category: string): string {
  return COURSE_SHORT[category] ?? category
}

const TRACK_HEIGHT = 18
const TRACK_GAP = 2

export interface MonthCalendarProps {
  month: Date
  onMonthChange: (d: Date) => void
  events: AppEvent[]
  onPickEvent: (ev: AppEvent) => void
  /** Optional list-item badge, e.g. "Booked" / "3 registered". Rendered at the right of each list card. */
  renderListBadge?: (ev: AppEvent) => React.ReactNode
  /** If true, the "this month" list hides events that have already started before today. */
  hidePastInList?: boolean
  /** Optional heading for the list below the grid. */
  listTitle?: string
}

export function MonthCalendar({
  month, onMonthChange, events, onPickEvent, renderListBadge, hidePastInList, listTitle = 'This month',
}: MonthCalendarProps) {
  const [diveShown, setDiveShown] = useState(true)
  const [hiddenCourses, setHiddenCourses] = useState<Set<string>>(new Set())

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })

  const courseCategories = useMemo(() => {
    const seen = new Set<string>()
    for (const e of events) if (e.type === 'course') seen.add(e.title)
    return Array.from(seen).sort()
  }, [events])

  const filteredEvents = useMemo(() => events.filter(e => {
    if (e.type === 'dive') return diveShown
    return !hiddenCourses.has(e.title)
  }), [events, diveShown, hiddenCourses])

  const ranges: EventRange[] = useMemo(() => assignTracks(filteredEvents), [filteredEvents])

  const cellTrackRows = useMemo(() => {
    let max = 0
    for (const r of ranges) {
      const monthStart = startOfMonth(month)
      const monthEnd = endOfMonth(month)
      if (r.end < monthStart || r.start > monthEnd) continue
      if (r.track + 1 > max) max = r.track + 1
    }
    return Math.min(max, 3)
  }, [ranges, month])

  const todayStart = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const inMonthEvents = useMemo(
    () => filteredEvents.filter(e =>
      (isSameMonth(new Date(e.start_time), month) || (e.end_time && isSameMonth(new Date(e.end_time), month)))
      && (!hidePastInList || new Date(e.start_time) >= todayStart)
    ),
    [filteredEvents, month, hidePastInList, todayStart]
  )

  function toggleCourseCategory(cat: string) {
    setHiddenCourses(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <FilterLegend
        diveShown={diveShown}
        onToggleDive={() => setDiveShown(v => !v)}
        courseCategories={courseCategories}
        hiddenCourses={hiddenCourses}
        onToggleCategory={toggleCourseCategory}
      />

      <div className="flex items-center justify-between">
        <button onClick={() => onMonthChange(subMonths(month, 1))} className="p-2 text-slate-400 hover:text-slate-100">‹</button>
        <h1 className="text-lg font-bold text-slate-100">{format(month, 'MMMM yyyy')}</h1>
        <button onClick={() => onMonthChange(addMonths(month, 1))} className="p-2 text-slate-400 hover:text-slate-100">›</button>
      </div>

      <MonthGrid
        month={month}
        days={days}
        ranges={ranges}
        trackRows={cellTrackRows}
        onPickEvent={onPickEvent}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">{listTitle}</h2>
        {inMonthEvents.length === 0 && (
          <p className="text-slate-500 text-sm">No events scheduled.</p>
        )}
        {inMonthEvents.map(ev => (
          <button
            key={ev.id}
            onClick={() => onPickEvent(ev)}
            className="w-full text-left bg-slate-800 rounded-xl p-3 hover:bg-slate-700 transition-colors"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${TYPE_DOT[ev.type]}`}>
                    {TYPE_LABELS[ev.type]}
                  </span>
                  <span className="font-medium text-slate-100 text-sm">{ev.title}</span>
                  {ev.featured && <span className="text-xs text-amber-400">★</span>}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {formatEventSpan(ev)}
                </p>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                {renderListBadge?.(ev)}
                {ev.fully_booked && (
                  <p className="text-xs text-rose-400 font-medium">Fully booked</p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

interface MonthGridProps {
  month: Date
  days: Date[]
  ranges: EventRange[]
  trackRows: number
  onPickEvent: (ev: AppEvent) => void
}

function MonthGrid({ month, days, ranges, trackRows, onPickEvent }: MonthGridProps) {
  const leading = days[0].getDay()
  const cellMinHeight = 22 + Math.max(1, trackRows) * (TRACK_HEIGHT + TRACK_GAP) + 6

  return (
    <div className="grid grid-cols-7 bg-slate-800 rounded-xl overflow-hidden text-sm">
      {['S','M','T','W','T','F','S'].map((d, i) => (
        <div key={i} className="bg-slate-900/40 text-center text-xs text-slate-500 py-1 border-b border-slate-700">{d}</div>
      ))}
      {Array.from({ length: leading }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="bg-slate-800 border-b border-slate-700/60"
          style={{ minHeight: cellMinHeight }}
        />
      ))}
      {days.map(day => (
        <DayCell
          key={day.toISOString()}
          day={day}
          ranges={ranges}
          month={month}
          trackRows={trackRows}
          minHeight={cellMinHeight}
          onPickEvent={onPickEvent}
        />
      ))}
    </div>
  )
}

function DayCell({
  day, ranges, month, trackRows, minHeight, onPickEvent,
}: {
  day: Date
  ranges: EventRange[]
  month: Date
  trackRows: number
  minHeight: number
  onPickEvent: (ev: AppEvent) => void
}) {
  const weekStart = startOfWeek(day, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(day, { weekStartsOn: 0 })
  const segMap = segmentsForDay(day, ranges, weekStart, weekEnd)
  const isToday = isSameDay(day, new Date())
  const inMonth = isSameMonth(day, month)

  const totalOnDay = segMap.size
  const visibleTracks = Math.max(1, trackRows)
  const overflow = Math.max(0, totalOnDay - visibleTracks)

  return (
    <div
      className={`relative pt-1 border-b border-slate-700/60 ${
        isToday ? 'bg-rose-900/30' : 'bg-slate-800'
      } ${!inMonth ? 'opacity-40' : ''}`}
      style={{ minHeight }}
    >
      <span className={`text-[10px] block text-center w-5 h-5 flex items-center justify-center mx-auto ${
        isToday ? 'text-rose-200 font-bold' : 'text-slate-300'
      }`}>
        {format(day, 'd')}
      </span>
      <div className="mt-1 relative" style={{ height: visibleTracks * (TRACK_HEIGHT + TRACK_GAP) }}>
        {Array.from(segMap.entries())
          .filter(([track]) => track < visibleTracks)
          .map(([track, seg]) => (
            <EventBar
              key={`${seg.event.id}_${seg.event.start_time}`}
              seg={seg}
              track={track}
              onClick={() => onPickEvent(seg.event)}
            />
          ))}
      </div>
      {overflow > 0 && (
        <div className="text-[9px] text-slate-400 text-center -mt-0.5">+{overflow} more</div>
      )}
    </div>
  )
}

function EventBar({ seg, track, onClick }: { seg: CellSegment; track: number; onClick: () => void }) {
  const baseClass = TYPE_BAR[seg.event.type]
  const leftInset = seg.isStart ? 2 : 0
  const rightInset = seg.isEnd ? 2 : 0
  const leftRadius = seg.isStart ? 'rounded-l-sm' : ''
  const rightRadius = seg.isEnd ? 'rounded-r-sm' : ''
  // Featured ring: gold on the outside edge only. Top + bottom always on;
  // left/right only on the true start/end cells so the middle days of a
  // multi-day featured event read as one continuous stripe, not a row of
  // individually ringed boxes.
  const featuredShadow = seg.event.featured
    ? [
        'inset 0 1px 0 rgb(252 211 77)',
        'inset 0 -1px 0 rgb(252 211 77)',
        seg.isStart ? 'inset 1px 0 0 rgb(252 211 77)' : '',
        seg.isEnd   ? 'inset -1px 0 0 rgb(252 211 77)' : '',
      ].filter(Boolean).join(', ')
    : undefined

  return (
    <button
      type="button"
      onClick={onClick}
      title={seg.event.title}
      className={`absolute text-[10px] font-semibold truncate text-left px-1 ${baseClass} ${leftRadius} ${rightRadius}`}
      style={{
        top: track * (TRACK_HEIGHT + TRACK_GAP),
        height: TRACK_HEIGHT,
        left: leftInset,
        right: rightInset,
        boxShadow: featuredShadow,
      }}
    >
      {seg.showTitle ? (
        <>
          {seg.event.featured && '★ '}
          {seg.event.title}
        </>
      ) : (
        <>&nbsp;</>
      )}
    </button>
  )
}

interface FilterLegendProps {
  diveShown: boolean
  onToggleDive: () => void
  courseCategories: string[]
  hiddenCourses: Set<string>
  onToggleCategory: (cat: string) => void
}

function FilterLegend({
  diveShown, onToggleDive,
  courseCategories, hiddenCourses, onToggleCategory,
}: FilterLegendProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const visibleCourses = courseCategories.length - hiddenCourses.size
  const allCoursesHidden = courseCategories.length > 0 && visibleCourses === 0

  return (
    <div className="flex items-center gap-2 text-xs" ref={ref}>
      <button
        type="button"
        onClick={onToggleDive}
        aria-pressed={diveShown}
        aria-label="Toggle dives"
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
          diveShown
            ? 'bg-slate-800 border-slate-600 text-slate-200'
            : 'bg-slate-900 border-slate-700 text-slate-500 line-through'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${TYPE_DOT.dive}`} />
        {TYPE_LABELS.dive}
      </button>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Filter courses"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
            allCoursesHidden
              ? 'bg-slate-900 border-slate-700 text-slate-500 line-through'
              : 'bg-slate-800 border-slate-600 text-slate-200'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${TYPE_DOT.course}`} />
          Courses
          {hiddenCourses.size > 0 && !allCoursesHidden && (
            <span className="ml-0.5 text-[10px] text-slate-400">({visibleCourses}/{courseCategories.length})</span>
          )}
          <span aria-hidden="true">▾</span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-1 z-20 min-w-[180px] bg-slate-900 border border-slate-700 rounded-lg shadow-lg p-2 space-y-1"
          >
            {courseCategories.length === 0 && (
              <p className="text-slate-500 text-xs px-2 py-1">No courses in this range.</p>
            )}
            {courseCategories.map(cat => {
              const shown = !hiddenCourses.has(cat)
              const short = courseShortLabel(cat)
              return (
                <label
                  key={cat}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={() => onToggleCategory(cat)}
                    className="accent-emerald-500"
                  />
                  <span className="text-slate-200 text-xs font-semibold">{short}</span>
                  {short !== cat && <span className="text-slate-500 text-[11px]">{cat}</span>}
                </label>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
