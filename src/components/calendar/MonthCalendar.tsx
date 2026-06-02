import { useEffect, useMemo, useRef, useState } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth,
  addMonths, subMonths, startOfWeek, endOfWeek,
} from 'date-fns'
import {
  assignTracks, segmentsForDay,
  type CellSegment, type EventRange, type LayoutEvent,
} from '../../lib/calendar-layout'
import { formatEventSpan } from '../../lib/events'
import type { AppEvent, StaffBusyEntry } from '../../types/database'

// Shared by CalendarPage (diver) and AdminEventsPage (admin). The only
// differences between those two surfaces are what happens when you pick an
// event, and what gets rendered in the "this month" list items — both
// expressed as props here so the grid + filter legend stay one copy.

// Base vs. hovered fills are split so we can cross-highlight every segment
// of a multi-day event when any one is hovered (see hoveredEventId state
// on MonthCalendar). The hover: variant is intentionally NOT on the base
// class — per-segment self-hover would only light up one day of a bar.
//
// Courses split into three color buckets so the calendar reads at a glance:
//   OW        → blue   (Open Water Course)
//   AOW       → orange (Advanced Open Water)
//   Specialty → pink   (Rescue, EFR, Equipment, Deep Specialty, and any
//                        other course that isn't OW/AOW)
// See courseColor() for the title-matching logic.
type CourseColor = 'ow' | 'aow' | 'specialty'

const DIVE_BAR       = 'bg-emerald-600 text-white'
const DIVE_BAR_HOVER = 'bg-emerald-500 text-white'
const DIVE_DOT       = 'bg-emerald-600'

const COURSE_BAR: Record<CourseColor, string> = {
  ow:        'bg-sky-500 text-white',
  aow:       'bg-orange-500 text-white',
  specialty: 'bg-pink-500 text-white',
}
const COURSE_BAR_HOVER: Record<CourseColor, string> = {
  ow:        'bg-sky-400 text-white',
  aow:       'bg-orange-400 text-white',
  specialty: 'bg-pink-400 text-white',
}
const COURSE_DOT: Record<CourseColor, string> = {
  ow:        'bg-sky-500',
  aow:       'bg-orange-500',
  specialty: 'bg-pink-500',
}

const TYPE_LABELS: Record<AppEvent['type'], string> = {
  dive:   'Dive',
  course: 'Course',
}

// Course titles arrive with a capacity hint appended by the
// display_title_capacity_suffix trigger (e.g. "Open Water Course (2 spots
// open)"). Strip the trailing parenthetical so we match against the
// canonical title.
function stripTitleSuffix(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function courseColor(title: string): CourseColor {
  const base = stripTitleSuffix(title)
  if (base.startsWith('Advanced Open Water')) return 'aow'
  if (base.startsWith('Open Water Course')) return 'ow'
  return 'specialty'
}

function eventBarClass(ev: AppEvent, hovered: boolean): string {
  if (ev.type === 'dive') return hovered ? DIVE_BAR_HOVER : DIVE_BAR
  const key = courseColor(ev.title)
  return hovered ? COURSE_BAR_HOVER[key] : COURSE_BAR[key]
}

function eventDotClass(ev: AppEvent): string {
  if (ev.type === 'dive') return DIVE_DOT
  return COURSE_DOT[courseColor(ev.title)]
}

// Busy/duty signals use violet so they don't collide with the new
// AOW-orange / Specialty-pink course palette. Own = vivid violet (you're
// the focal point of your own calendar); other staff = neutral gray so
// they read as "background constraints to plan around" rather than
// competing for attention.
const OWN_BUSY_BAR         = 'bg-violet-600 text-white'
const OWN_BUSY_BAR_HOVER   = 'bg-violet-500 text-white'
const OTHER_BUSY_BAR       = 'bg-slate-500 text-white'
const OTHER_BUSY_BAR_HOVER = 'bg-slate-400 text-white'
const BUSY_DOT             = 'bg-violet-600'

// On day-segments where the viewer is on duty, a violet-600 diagonal
// stripe pattern overlays the event's base color (the underlying type
// fill still shows through the gaps so the bar still reads as a
// dive/course, just "claimed" by the viewer). violet-600 = #7c3aed, the
// same shade as own-busy bars so the two duty-signals share one palette.
const OWN_DUTY_STRIPE = 'repeating-linear-gradient(45deg, transparent 0 6px, #7c3aed 6px 12px)'

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

// Project a staff_busy view row into the LayoutEvent shape so it can
// share the track allocator. end_date is inclusive (busy through end of
// day), so we anchor end_time at the end of that day rather than midnight
// (which would round down to the previous day on toLocaleDateString diffs).
interface BusyLayoutEvent extends LayoutEvent {
  busy: StaffBusyEntry
  /** Whether this row belongs to the current viewer. Own rows show their
   *  real title; other rows show only the owner's display name (title is
   *  null in that case because the view masks it). */
  isOwn: boolean
}
function toBusyLayoutEvent(b: StaffBusyEntry, currentUserId: string | null): BusyLayoutEvent {
  return {
    id: b.id,
    // 'YYYY-MM-DDTHH:MM:SS' parses as local time, which is what we want —
    // start_date/start_time/end_date are stored as naive calendar values.
    start_time: `${b.start_date}T${b.start_time}`,
    end_time:   `${b.end_date}T23:59:59`,
    busy: b,
    isOwn: !!currentUserId && b.user_id === currentUserId,
  }
}

function busyDisplayLabel(entry: StaffBusyEntry, isOwn: boolean): string {
  if (isOwn) return entry.title ?? entry.owner_display_name ?? 'Busy'
  return entry.owner_display_name ?? 'Busy'
}

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
  /** Event ids to visually highlight on the grid and the list (e.g. the
   *  current multi-event cart). Each highlighted EventBar gets an amber
   *  ring; the corresponding list row gets a tinted background. */
  highlightedIds?: Set<string>

  // ── Staff availability overlay (optional) ────────────────────────────
  /** Staff_busy rows touching the visible range. When omitted the overlay is fully off. */
  busyEntries?: StaffBusyEntry[]
  /** Controlled state of the Busy toggle. The parent owns this so the
   *  default can wait for async profile data (initializing here would
   *  freeze the value at first render, before useAuth resolves). */
  busyShown?: boolean
  /** Toggle handler — paired with busyShown. The pill renders only when
   *  busyEntries AND onToggleBusy are both provided. */
  onToggleBusy?: () => void
  /** Current viewer's user id — used to mark "own" rows for tap routing. */
  currentUserId?: string | null
  /** Per-event map of YYYY-MM-DD day-strings the viewer is on duty for.
   *  Key = EO_dives._id / EO_courses._id; value = set of days. Each
   *  day-segment whose date is in the set renders an amber stripe
   *  overlay so the viewer sees which specific days are theirs to
   *  work, not just which events touch their duty list. */
  ownDutyDays?: Map<string, Set<string>>
  /** Click handler for tapping an empty cell. Triggers a "mark busy" flow. */
  onCreateBusy?: (day: Date) => void
  /** Click handler for tapping an existing busy bar. */
  onPickBusy?: (b: StaffBusyEntry) => void
}

export function MonthCalendar({
  month, onMonthChange, events, onPickEvent, renderListBadge, hidePastInList, listTitle = 'This month',
  highlightedIds,
  busyEntries, busyShown, onToggleBusy, currentUserId, ownDutyDays, onCreateBusy, onPickBusy,
}: MonthCalendarProps) {
  const [diveShown, setDiveShown] = useState(true)
  const [hiddenCourses, setHiddenCourses] = useState<Set<string>>(new Set())
  // When any segment of a multi-day event is hovered, the parent tracks the
  // event id so every segment of that event can cross-highlight. Cleared on
  // mouse leave.
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null)

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

  const ranges: EventRange<AppEvent>[] = useMemo(() => assignTracks(filteredEvents), [filteredEvents])

  const busyOverlayEnabled = busyEntries !== undefined && onToggleBusy !== undefined
  const busyLayoutEvents = useMemo<BusyLayoutEvent[]>(() => {
    if (!busyOverlayEnabled || !busyShown) return []
    return (busyEntries ?? []).map(b => toBusyLayoutEvent(b, currentUserId ?? null))
  }, [busyEntries, busyOverlayEnabled, busyShown, currentUserId])
  const busyRanges: EventRange<BusyLayoutEvent>[] = useMemo(
    () => assignTracks(busyLayoutEvents),
    [busyLayoutEvents],
  )

  // Cells grow to fit every track in use that month — no overflow / "+N more"
  // truncation. Days are capped at a couple of events in practice, so a
  // hard limit isn't earning its keep. Event + busy tracks are stacked
  // (events first, busy below) so the cell height is the sum.
  const cellTrackRows = useMemo(() => {
    let max = 0
    for (const r of ranges) {
      const monthStart = startOfMonth(month)
      const monthEnd = endOfMonth(month)
      if (r.end < monthStart || r.start > monthEnd) continue
      if (r.track + 1 > max) max = r.track + 1
    }
    return max
  }, [ranges, month])
  const cellBusyTrackRows = useMemo(() => {
    let max = 0
    for (const r of busyRanges) {
      const monthStart = startOfMonth(month)
      const monthEnd = endOfMonth(month)
      if (r.end < monthStart || r.start > monthEnd) continue
      if (r.track + 1 > max) max = r.track + 1
    }
    return max
  }, [busyRanges, month])

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
        busyToggle={busyOverlayEnabled ? { shown: !!busyShown, onToggle: onToggleBusy! } : undefined}
      />

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => onMonthChange(subMonths(month, 1))}
          aria-label="Previous month"
          className="flex-1 flex items-center justify-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/30 text-white text-2xl leading-none transition-colors"
        >
          ‹
        </button>
        <h1 className="text-lg font-bold text-white shrink-0">{format(month, 'MMMM yyyy')}</h1>
        <button
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="Next month"
          className="flex-1 flex items-center justify-center px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/30 text-white text-2xl leading-none transition-colors"
        >
          ›
        </button>
      </div>

      <MonthGrid
        month={month}
        days={days}
        ranges={ranges}
        busyRanges={busyRanges}
        trackRows={cellTrackRows}
        busyTrackRows={cellBusyTrackRows}
        ownDutyDays={ownDutyDays}
        highlightedIds={highlightedIds}
        onPickEvent={onPickEvent}
        onPickBusy={onPickBusy}
        onCreateBusy={onCreateBusy}
        hoveredEventId={hoveredEventId}
        onHoverEvent={setHoveredEventId}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{listTitle}</h2>
        {inMonthEvents.length === 0 && (
          <p className="text-blue-950 font-medium text-sm">No events scheduled.</p>
        )}
        {inMonthEvents.map(ev => (
          <button
            key={ev.id}
            onClick={() => onPickEvent(ev)}
            className={`w-full text-left backdrop-blur-md rounded-xl p-3 transition-colors ${
              highlightedIds?.has(ev.id)
                ? 'bg-amber-100 border-2 border-amber-400 hover:border-amber-500'
                : 'bg-white/70 border border-sky-200 hover:border-red-500'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full text-white ${eventDotClass(ev)}`}>
                    {TYPE_LABELS[ev.type]}
                  </span>
                  <span className="font-medium text-blue-900 text-sm">{ev.title}</span>
                  {ev.featured && <span className="text-xs text-red-600">★</span>}
                </div>
                <p className="text-xs text-blue-900 font-medium mt-1">
                  {formatEventSpan(ev)}
                </p>
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                {renderListBadge?.(ev)}
                {/* Capacity status is now baked into ev.title by the
                    display_title_capacity_suffix trigger (migration
                    20260514020000), so no extra badge needed here. */}
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
  ranges: EventRange<AppEvent>[]
  busyRanges: EventRange<BusyLayoutEvent>[]
  trackRows: number
  busyTrackRows: number
  ownDutyDays?: Map<string, Set<string>>
  highlightedIds?: Set<string>
  onPickEvent: (ev: AppEvent) => void
  onPickBusy?: (b: StaffBusyEntry) => void
  onCreateBusy?: (day: Date) => void
  hoveredEventId: string | null
  onHoverEvent: (id: string | null) => void
}

function MonthGrid({
  month, days, ranges, busyRanges, trackRows, busyTrackRows, ownDutyDays, highlightedIds,
  onPickEvent, onPickBusy, onCreateBusy, hoveredEventId, onHoverEvent,
}: MonthGridProps) {
  const leading = days[0].getDay()
  const totalRows = Math.max(1, trackRows) + busyTrackRows
  const cellMinHeight = 22 + totalRows * (TRACK_HEIGHT + TRACK_GAP) + 6

  return (
    <div className="grid grid-cols-7 bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl overflow-hidden text-sm">
      {['S','M','T','W','T','F','S'].map((d, i) => (
        <div key={i} className="bg-sky-100 text-center text-xs text-blue-900 font-semibold py-1 border-b border-sky-200">{d}</div>
      ))}
      {Array.from({ length: leading }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="bg-sky-50/50 border-b border-sky-200/60"
          style={{ minHeight: cellMinHeight }}
        />
      ))}
      {days.map(day => (
        <DayCell
          key={day.toISOString()}
          day={day}
          ranges={ranges}
          busyRanges={busyRanges}
          month={month}
          trackRows={trackRows}
          busyTrackRows={busyTrackRows}
          minHeight={cellMinHeight}
          ownDutyDays={ownDutyDays}
          highlightedIds={highlightedIds}
          onPickEvent={onPickEvent}
          onPickBusy={onPickBusy}
          onCreateBusy={onCreateBusy}
          hoveredEventId={hoveredEventId}
          onHoverEvent={onHoverEvent}
        />
      ))}
    </div>
  )
}

function DayCell({
  day, ranges, busyRanges, month, trackRows, busyTrackRows, minHeight, ownDutyDays, highlightedIds,
  onPickEvent, onPickBusy, onCreateBusy, hoveredEventId, onHoverEvent,
}: {
  day: Date
  ranges: EventRange<AppEvent>[]
  busyRanges: EventRange<BusyLayoutEvent>[]
  month: Date
  trackRows: number
  busyTrackRows: number
  minHeight: number
  ownDutyDays?: Map<string, Set<string>>
  highlightedIds?: Set<string>
  onPickEvent: (ev: AppEvent) => void
  onPickBusy?: (b: StaffBusyEntry) => void
  onCreateBusy?: (day: Date) => void
  hoveredEventId: string | null
  onHoverEvent: (id: string | null) => void
}) {
  const weekStart = startOfWeek(day, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(day, { weekStartsOn: 0 })
  const segMap = segmentsForDay(day, ranges, weekStart, weekEnd)
  const busySegMap = segmentsForDay(day, busyRanges, weekStart, weekEnd)
  const isToday = isSameDay(day, new Date())
  const inMonth = isSameMonth(day, month)
  const dayKey = format(day, 'yyyy-MM-dd')

  const trackRowCount = Math.max(1, trackRows)
  const eventStripHeight = trackRowCount * (TRACK_HEIGHT + TRACK_GAP)
  const busyStripHeight = busyTrackRows * (TRACK_HEIGHT + TRACK_GAP)

  // The whole cell is a click target for "mark busy" when onCreateBusy is
  // wired; event/busy bars stopPropagation so they keep their own intent.
  const cellClickable = !!onCreateBusy
  const handleCellClick = cellClickable ? () => onCreateBusy!(day) : undefined

  return (
    <div
      onClick={handleCellClick}
      className={`relative pt-1 border-b border-sky-200/60 ${
        isToday ? 'bg-red-50' : ''
      } ${!inMonth ? 'opacity-40' : ''} ${cellClickable ? 'cursor-pointer hover:bg-amber-50/60' : ''}`}
      style={{ minHeight }}
    >
      <span className={`text-[10px] block text-center w-5 h-5 flex items-center justify-center mx-auto ${
        isToday ? 'text-red-700 font-bold' : 'text-blue-900'
      }`}>
        {format(day, 'd')}
      </span>
      <div className="mt-1 relative" style={{ height: eventStripHeight }}>
        {Array.from(segMap.entries()).map(([track, seg]) => (
          <EventBar
            key={`${seg.event.id}_${seg.event.start_time}`}
            seg={seg}
            track={track}
            isOwnDuty={!!ownDutyDays?.get(seg.event.id)?.has(dayKey)}
            highlighted={!!highlightedIds?.has(seg.event.id)}
            onClick={() => onPickEvent(seg.event)}
            hovered={hoveredEventId === seg.event.id}
            onHoverEvent={onHoverEvent}
          />
        ))}
      </div>
      {busyTrackRows > 0 && (
        <div className="relative" style={{ height: busyStripHeight }}>
          {Array.from(busySegMap.entries()).map(([track, seg]) => (
            <BusyBar
              key={`busy_${seg.event.id}_${seg.event.start_time}`}
              seg={seg}
              track={track}
              onClick={onPickBusy ? () => onPickBusy(seg.event.busy) : undefined}
              hovered={hoveredEventId === seg.event.id}
              onHoverEvent={onHoverEvent}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EventBar({ seg, track, isOwnDuty, highlighted, onClick, hovered, onHoverEvent }: {
  seg: CellSegment<AppEvent>
  track: number
  isOwnDuty: boolean
  highlighted: boolean
  onClick: () => void
  hovered: boolean
  onHoverEvent: (id: string | null) => void
}) {
  const baseClass = eventBarClass(seg.event, hovered)
  const leftInset = seg.isStart ? 2 : 0
  const rightInset = seg.isEnd ? 2 : 0
  const leftRadius = seg.isStart ? 'rounded-l-sm' : ''
  const rightRadius = seg.isEnd ? 'rounded-r-sm' : ''
  // Featured ring: gold on the outside edge only. Top + bottom always on;
  // left/right only on the true start/end cells so the middle days of a
  // multi-day featured event read as one continuous stripe, not a row of
  // individually ringed boxes.
  //
  // Highlight ring (multi-event cart selection): a thicker amber inset on
  // the same edges. Takes precedence over featured since the diver is
  // actively staging this event for registration — they need to see at a
  // glance which bars they've added.
  const ringColor = highlighted ? 'rgb(217 119 6)' : 'rgb(252 211 77)'
  const ringWidth = highlighted ? '2px' : '1px'
  const showRing = highlighted || seg.event.featured
  const featuredShadow = showRing
    ? [
        `inset 0 ${ringWidth} 0 ${ringColor}`,
        `inset 0 -${ringWidth} 0 ${ringColor}`,
        seg.isStart ? `inset ${ringWidth} 0 0 ${ringColor}` : '',
        seg.isEnd   ? `inset -${ringWidth} 0 0 ${ringColor}` : '',
      ].filter(Boolean).join(', ')
    : undefined

  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onClick() }}
      onMouseEnter={() => onHoverEvent(seg.event.id)}
      onMouseLeave={() => onHoverEvent(null)}
      title={seg.event.title}
      className={`absolute text-[10px] font-semibold truncate text-left px-1 transition-colors ${baseClass} ${leftRadius} ${rightRadius}`}
      style={{
        top: track * (TRACK_HEIGHT + TRACK_GAP),
        height: TRACK_HEIGHT,
        left: leftInset,
        right: rightInset,
        backgroundImage: isOwnDuty ? OWN_DUTY_STRIPE : undefined,
        boxShadow: featuredShadow,
      }}
    >
      {seg.showTitle ? (
        <>
          {seg.event.featured && '★ '}
          {seg.event.calendar_title || seg.event.title}
        </>
      ) : (
        <>&nbsp;</>
      )}
    </button>
  )
}

function BusyBar({ seg, track, onClick, hovered, onHoverEvent }: {
  seg: CellSegment<BusyLayoutEvent>
  track: number
  onClick?: () => void
  hovered: boolean
  onHoverEvent: (id: string | null) => void
}) {
  const baseClass = seg.event.isOwn
    ? (hovered ? OWN_BUSY_BAR_HOVER   : OWN_BUSY_BAR)
    : (hovered ? OTHER_BUSY_BAR_HOVER : OTHER_BUSY_BAR)
  const leftInset = seg.isStart ? 2 : 0
  const rightInset = seg.isEnd ? 2 : 0
  const leftRadius = seg.isStart ? 'rounded-l-sm' : ''
  const rightRadius = seg.isEnd ? 'rounded-r-sm' : ''
  const isClickable = !!onClick
  const label = busyDisplayLabel(seg.event.busy, seg.event.isOwn)

  return (
    <button
      type="button"
      disabled={!isClickable}
      onClick={onClick ? e => { e.stopPropagation(); onClick() } : undefined}
      onMouseEnter={() => onHoverEvent(seg.event.id)}
      onMouseLeave={() => onHoverEvent(null)}
      title={label}
      className={`absolute text-[10px] font-semibold truncate text-left px-1 transition-colors ${baseClass} ${leftRadius} ${rightRadius} ${isClickable ? '' : 'cursor-default'}`}
      style={{
        top: track * (TRACK_HEIGHT + TRACK_GAP),
        height: TRACK_HEIGHT,
        left: leftInset,
        right: rightInset,
      }}
    >
      {seg.showTitle ? label : <>&nbsp;</>}
    </button>
  )
}

interface FilterLegendProps {
  diveShown: boolean
  onToggleDive: () => void
  courseCategories: string[]
  hiddenCourses: Set<string>
  onToggleCategory: (cat: string) => void
  busyToggle?: { shown: boolean; onToggle: () => void }
}

function FilterLegend({
  diveShown, onToggleDive,
  courseCategories, hiddenCourses, onToggleCategory,
  busyToggle,
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
            ? 'bg-white border-blue-900 text-blue-900'
            : 'bg-sky-100 border-sky-200 text-blue-950 font-medium line-through'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${DIVE_DOT}`} />
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
              ? 'bg-sky-100 border-sky-200 text-blue-950 font-medium line-through'
              : 'bg-white border-blue-900 text-blue-900'
          }`}
        >
          <span className="w-2 h-2 rounded-full overflow-hidden flex" aria-hidden="true">
            <span className={`flex-1 ${COURSE_DOT.ow}`} />
            <span className={`flex-1 ${COURSE_DOT.aow}`} />
            <span className={`flex-1 ${COURSE_DOT.specialty}`} />
          </span>
          Courses
          {hiddenCourses.size > 0 && !allCoursesHidden && (
            <span className="ml-0.5 text-[10px] text-blue-900 font-medium">({visibleCourses}/{courseCategories.length})</span>
          )}
          <span aria-hidden="true">▾</span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-1 z-20 min-w-[180px] bg-white border border-red-500 rounded-lg shadow-lg p-2 space-y-1"
          >
            {courseCategories.length === 0 && (
              <p className="text-blue-900 font-medium text-xs px-2 py-1">No courses in this range.</p>
            )}
            {courseCategories.map(cat => {
              const shown = !hiddenCourses.has(cat)
              const short = courseShortLabel(cat)
              const dot = COURSE_DOT[courseColor(cat)]
              return (
                <label
                  key={cat}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-sky-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={() => onToggleCategory(cat)}
                    className="accent-blue-900"
                  />
                  <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
                  <span className="text-blue-900 text-xs font-semibold">{short}</span>
                  {short !== cat && <span className="text-blue-900 font-medium text-[11px]">{cat}</span>}
                </label>
              )
            })}
          </div>
        )}
      </div>

      {busyToggle && (
        <button
          type="button"
          onClick={busyToggle.onToggle}
          aria-pressed={busyToggle.shown}
          aria-label="Toggle staff availability"
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${
            busyToggle.shown
              ? 'bg-white border-blue-900 text-blue-900'
              : 'bg-sky-100 border-sky-200 text-blue-950 font-medium line-through'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${BUSY_DOT}`} />
          Busy
        </button>
      )}
    </div>
  )
}
