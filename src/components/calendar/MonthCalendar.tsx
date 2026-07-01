import { useEffect, useMemo, useRef, useState } from 'react'
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth,
  addMonths, subMonths, startOfWeek, endOfWeek,
} from 'date-fns'
import {
  assignTracks, segmentsForDay,
  type CellSegment, type EventRange, type LayoutEvent,
} from '../../lib/calendar-layout'
import { formatEventSpan, isPastEvent } from '../../lib/events'
import { courseColor, diveIsTripOrBoat, type CourseColor } from '../../lib/event-colors'
import { isReschedulable } from '../../lib/reschedule'
import { ConfirmDialog } from '../ui/ConfirmDialog'
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
// The color buckets (course title / dive destination matching) live in
// src/lib/event-colors.ts so they stay unit-testable; this file only owns
// the Tailwind classes each bucket maps to.
//   Courses: ow → blue, aow → orange, dsd → pink, rescue → red, specialty → purple.
//   Dives:   local → green, trip (boat or beyond Keelung) → yellow.

// Yellow needs dark text to stay legible; every other fill pairs with white.
const DIVE_LOCAL_BAR       = 'bg-emerald-600 text-white'
const DIVE_LOCAL_BAR_HOVER = 'bg-emerald-500 text-white'
const DIVE_LOCAL_DOT       = 'bg-emerald-600'
const DIVE_TRIP_BAR        = 'bg-yellow-400 text-brand-950'
const DIVE_TRIP_BAR_HOVER  = 'bg-yellow-300 text-brand-950'
const DIVE_TRIP_DOT        = 'bg-yellow-400'

// Categorical event-type palette — a fixed rainbow (blue/orange/pink/red/purple)
// that distinguishes course types, independent of the brand color. Kept on the
// raw Tailwind palette on purpose so re-skinning the brand doesn't collapse OW
// into the brand hue or clash with the other categories.
const COURSE_BAR: Record<CourseColor, string> = {
  ow:        'bg-blue-600 text-white',
  aow:       'bg-orange-500 text-white',
  dsd:       'bg-pink-500 text-white',
  rescue:    'bg-red-600 text-white',
  specialty: 'bg-purple-600 text-white',
}
const COURSE_BAR_HOVER: Record<CourseColor, string> = {
  ow:        'bg-blue-500 text-white',
  aow:       'bg-orange-400 text-white',
  dsd:       'bg-pink-400 text-white',
  rescue:    'bg-red-500 text-white',
  specialty: 'bg-purple-500 text-white',
}
const COURSE_DOT: Record<CourseColor, string> = {
  ow:        'bg-blue-600',
  aow:       'bg-orange-500',
  dsd:       'bg-pink-500',
  rescue:    'bg-red-600',
  specialty: 'bg-purple-600',
}

const TYPE_LABELS: Record<AppEvent['type'], string> = {
  dive:   'Dive',
  course: 'Course',
}

function eventBarClass(ev: AppEvent, hovered: boolean): string {
  if (ev.type === 'dive') {
    if (diveIsTripOrBoat(ev)) return hovered ? DIVE_TRIP_BAR_HOVER : DIVE_TRIP_BAR
    return hovered ? DIVE_LOCAL_BAR_HOVER : DIVE_LOCAL_BAR
  }
  const key = courseColor(ev.title)
  return hovered ? COURSE_BAR_HOVER[key] : COURSE_BAR[key]
}

// Closed-eye (eye-off) marker for private dives — admin-only, since private
// events are filtered out of every diver-facing fetch before they'd render.
function PrivateIcon({ className = 'w-3.5 h-3.5 text-brand-900/70 shrink-0' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         className={className} role="img" aria-label="Private">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

// Busy/duty signals use violet. It's adjacent to the specialty-course
// purple, but the busy overlay renders in its own strip below the event
// bars so the two never sit side by side. Own = vivid violet (you're the
// focal point of your own calendar); other staff = neutral gray so they
// read as "background constraints to plan around" rather than competing
// for attention.
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
  /** If true, grid bars for events that have already happened render muted and
   *  non-clickable (diver calendar — you can't book the past). Admins leave it
   *  off so they can still open past events to manage them. */
  disablePastEvents?: boolean
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
  /** Admin-only: persist a one-day move of an event. When provided,
   *  reschedulable event bars (see isReschedulable) become drag targets —
   *  long-press on touch / press-drag with a mouse, then a confirm dialog.
   *  `fromKey`/`toKey` are 'YYYY-MM-DD'. Omit on diver surfaces to disable. */
  onRescheduleDay?: (event: AppEvent, fromKey: string, toKey: string) => Promise<void>
}

export function MonthCalendar({
  month, onMonthChange, events, onPickEvent, renderListBadge, hidePastInList, listTitle = 'This month',
  highlightedIds, disablePastEvents,
  busyEntries, busyShown, onToggleBusy, currentUserId, ownDutyDays, onCreateBusy, onPickBusy,
  onRescheduleDay,
}: MonthCalendarProps) {
  const [diveShown, setDiveShown] = useState(true)
  const [hiddenCourses, setHiddenCourses] = useState<Set<string>>(new Set())
  // When any segment of a multi-day event is hovered, the parent tracks the
  // event id so every segment of that event can cross-highlight. Cleared on
  // mouse leave.
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null)

  // Drag-to-reschedule (admin). `dropTargetKey` highlights the cell under
  // an in-flight drag; `pending` holds the proposed move until confirmed.
  const rescheduleEnabled = !!onRescheduleDay
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null)
  const [pending, setPending] = useState<{ event: AppEvent; fromKey: string; toKey: string } | null>(null)

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })

  // Group courses by admin_title (course type) rather than the diver-facing
  // title — the latter varies per offering and carries a capacity suffix, so
  // it produces a noisy, repetitive filter ("OW", "Open Water", "Open Water (1
  // remaining)"). One row per type; the dot's color comes from a representative
  // event (display_title still drives the bar color, so it's uniform per type).
  const courseCategories = useMemo(() => {
    const byCat = new Map<string, CourseColor>()
    for (const e of events) {
      if (e.type !== 'course') continue
      const cat = e.course_category ?? e.title
      if (!byCat.has(cat)) byCat.set(cat, courseColor(e.title))
    }
    return Array.from(byCat, ([category, color]) => ({ category, color }))
      .sort((a, b) => a.category.localeCompare(b.category))
  }, [events])

  const filteredEvents = useMemo(() => events.filter(e => {
    if (e.type === 'dive') return diveShown
    return !hiddenCourses.has(e.course_category ?? e.title)
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
        disablePastEvents={disablePastEvents}
        onPickEvent={onPickEvent}
        onPickBusy={onPickBusy}
        onCreateBusy={onCreateBusy}
        hoveredEventId={hoveredEventId}
        onHoverEvent={setHoveredEventId}
        rescheduleEnabled={rescheduleEnabled}
        dropTargetKey={dropTargetKey}
        onDragHoverDay={setDropTargetKey}
        onDropReschedule={(event, fromKey, toKey) => setPending({ event, fromKey, toKey })}
      />

      {pending && onRescheduleDay && (
        <ConfirmDialog
          title="Move event day"
          confirmLabel="Move it"
          message={
            <>
              Change <span className="font-semibold">{pending.event.calendar_title || pending.event.title}</span>{' '}
              from <span className="font-semibold">{format(parseISO(pending.fromKey), 'EEE, MMM d')}</span>{' '}
              to <span className="font-semibold">{format(parseISO(pending.toKey), 'EEE, MMM d')}</span>?
            </>
          }
          onConfirm={async () => {
            await onRescheduleDay(pending.event, pending.fromKey, pending.toKey)
            setPending(null)
          }}
          onCancel={() => setPending(null)}
        />
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{listTitle}</h2>
        {inMonthEvents.length === 0 && (
          <p className="text-brand-950 font-medium text-sm">No events scheduled.</p>
        )}
        {inMonthEvents.map(ev => (
          <button
            key={ev.id}
            onClick={() => onPickEvent(ev)}
            className={`w-full text-left backdrop-blur-md rounded-xl p-3 transition-colors ${
              highlightedIds?.has(ev.id)
                ? 'bg-amber-100 border-2 border-amber-400 hover:border-amber-500'
                : 'bg-white/70 border border-surface-200 hover:border-accent'
            } ${ev.is_private ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${eventBarClass(ev, false)}`}>
                    {TYPE_LABELS[ev.type]}
                  </span>
                  {ev.is_private && <PrivateIcon />}
                  <span className="font-medium text-brand-900 text-sm">{ev.title}</span>
                  {ev.featured && <span className="text-xs text-red-600">★</span>}
                </div>
                <p className="text-xs text-brand-900 font-medium mt-1">
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
  disablePastEvents?: boolean
  onPickEvent: (ev: AppEvent) => void
  onPickBusy?: (b: StaffBusyEntry) => void
  onCreateBusy?: (day: Date) => void
  hoveredEventId: string | null
  onHoverEvent: (id: string | null) => void
  rescheduleEnabled: boolean
  dropTargetKey: string | null
  onDragHoverDay: (key: string | null) => void
  onDropReschedule: (event: AppEvent, fromKey: string, toKey: string) => void
}

function MonthGrid({
  month, days, ranges, busyRanges, trackRows, busyTrackRows, ownDutyDays, highlightedIds, disablePastEvents,
  onPickEvent, onPickBusy, onCreateBusy, hoveredEventId, onHoverEvent,
  rescheduleEnabled, dropTargetKey, onDragHoverDay, onDropReschedule,
}: MonthGridProps) {
  const leading = days[0].getDay()
  const totalRows = Math.max(1, trackRows) + busyTrackRows
  const cellMinHeight = 22 + totalRows * (TRACK_HEIGHT + TRACK_GAP) + 6

  return (
    <div className="grid grid-cols-7 bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl overflow-hidden text-sm">
      {['S','M','T','W','T','F','S'].map((d, i) => (
        <div key={i} className="bg-surface-100 text-center text-xs text-brand-900 font-semibold py-1 border-b border-surface-200">{d}</div>
      ))}
      {Array.from({ length: leading }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className="bg-surface-50/50 border-b border-surface-200/60"
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
          disablePastEvents={disablePastEvents}
          onPickEvent={onPickEvent}
          onPickBusy={onPickBusy}
          onCreateBusy={onCreateBusy}
          hoveredEventId={hoveredEventId}
          onHoverEvent={onHoverEvent}
          rescheduleEnabled={rescheduleEnabled}
          dropTargetKey={dropTargetKey}
          onDragHoverDay={onDragHoverDay}
          onDropReschedule={onDropReschedule}
        />
      ))}
    </div>
  )
}

function DayCell({
  day, ranges, busyRanges, month, trackRows, busyTrackRows, minHeight, ownDutyDays, highlightedIds, disablePastEvents,
  onPickEvent, onPickBusy, onCreateBusy, hoveredEventId, onHoverEvent,
  rescheduleEnabled, dropTargetKey, onDragHoverDay, onDropReschedule,
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
  disablePastEvents?: boolean
  onPickEvent: (ev: AppEvent) => void
  onPickBusy?: (b: StaffBusyEntry) => void
  onCreateBusy?: (day: Date) => void
  hoveredEventId: string | null
  onHoverEvent: (id: string | null) => void
  rescheduleEnabled: boolean
  dropTargetKey: string | null
  onDragHoverDay: (key: string | null) => void
  onDropReschedule: (event: AppEvent, fromKey: string, toKey: string) => void
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
  const isDropTarget = dropTargetKey === dayKey

  return (
    <div
      data-day={dayKey}
      onClick={handleCellClick}
      className={`relative pt-1 border-b border-surface-200/60 ${
        isToday ? 'bg-red-50' : ''
      } ${!inMonth ? 'opacity-40' : ''} ${cellClickable ? 'cursor-pointer hover:bg-amber-50/60' : ''} ${
        isDropTarget ? 'ring-2 ring-inset ring-amber-400 bg-amber-50/70' : ''
      }`}
      style={{ minHeight }}
    >
      <span className={`text-[10px] block text-center w-5 h-5 flex items-center justify-center mx-auto ${
        isToday ? 'text-red-700 font-bold' : 'text-brand-900'
      }`}>
        {format(day, 'd')}
      </span>
      <div className="mt-1 relative" style={{ height: eventStripHeight }}>
        {Array.from(segMap.entries()).map(([track, seg]) => (
          <EventBar
            key={`${seg.event.id}_${seg.event.start_time}`}
            seg={seg}
            track={track}
            dayKey={dayKey}
            isOwnDuty={!!ownDutyDays?.get(seg.event.id)?.has(dayKey)}
            highlighted={!!highlightedIds?.has(seg.event.id)}
            disabled={!!disablePastEvents && isPastEvent(seg.event)}
            onClick={() => onPickEvent(seg.event)}
            hovered={hoveredEventId === seg.event.id}
            onHoverEvent={onHoverEvent}
            draggable={rescheduleEnabled && isReschedulable(seg.event)}
            onDragHoverDay={onDragHoverDay}
            onDropReschedule={onDropReschedule}
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

// How long a press must be held (ms) before a drag begins, and how far the
// pointer may travel first before we treat it as a scroll/swipe and abort.
const LONG_PRESS_MS = 400
const MOVE_CANCEL_PX = 10

function dayKeyAtPoint(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)
  return el?.closest('[data-day]')?.getAttribute('data-day') ?? null
}

function EventBar({
  seg, track, dayKey, isOwnDuty, highlighted, disabled, onClick, hovered, onHoverEvent,
  draggable, onDragHoverDay, onDropReschedule,
}: {
  seg: CellSegment<AppEvent>
  track: number
  dayKey: string
  isOwnDuty: boolean
  highlighted: boolean
  /** Event already happened on a surface that forbids booking the past. The
   *  bar renders muted and ignores taps/drags. */
  disabled: boolean
  onClick: () => void
  hovered: boolean
  onHoverEvent: (id: string | null) => void
  draggable: boolean
  onDragHoverDay: (key: string | null) => void
  onDropReschedule: (event: AppEvent, fromKey: string, toKey: string) => void
}) {
  // Long-press-then-drag state. All kept in refs so pointermove doesn't
  // re-render per frame; only `lifted` (the visual "picked up" cue) is
  // state. `suppressClick` swallows the synthetic click that follows a
  // pointerup we've already handled (tap → select, drag → confirm).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPt = useRef<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const aborted = useRef(false)
  const suppressClick = useRef(false)
  const [lifted, setLifted] = useState(false)

  function reset() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    startPt.current = null
    dragging.current = false
    setLifted(false)
    onDragHoverDay(null)
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!draggable) return
    startPt.current = { x: e.clientX, y: e.clientY }
    dragging.current = false
    aborted.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
    timer.current = setTimeout(() => {
      dragging.current = true
      setLifted(true)
      navigator.vibrate?.(10)
      onDragHoverDay(dayKey)
    }, LONG_PRESS_MS)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggable || !startPt.current) return
    if (dragging.current) {
      // Active drag — block scroll and track the cell under the pointer.
      e.preventDefault()
      onDragHoverDay(dayKeyAtPoint(e.clientX, e.clientY))
      return
    }
    const dx = e.clientX - startPt.current.x
    const dy = e.clientY - startPt.current.y
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) {
      // Moved before the hold completed → it's a scroll/swipe, not a drag.
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
      aborted.current = true
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!draggable) return
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (dragging.current) {
      const target = dayKeyAtPoint(e.clientX, e.clientY)
      suppressClick.current = true
      reset()
      if (target && target !== dayKey) onDropReschedule(seg.event, dayKey, target)
    } else if (!aborted.current) {
      // Clean tap → select. Suppress the trailing synthetic click.
      suppressClick.current = true
      reset()
      onClick()
    } else {
      reset()
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (disabled) return
    if (suppressClick.current) { suppressClick.current = false; return }
    // Non-draggable bars (diver calendar, multi-day dives) never set up
    // pointer handling, so the native click drives selection as before.
    if (!draggable) onClick()
  }

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
      onClick={handleClick}
      aria-disabled={disabled || undefined}
      onPointerDown={draggable && !disabled ? onPointerDown : undefined}
      onPointerMove={draggable && !disabled ? onPointerMove : undefined}
      onPointerUp={draggable && !disabled ? onPointerUp : undefined}
      onPointerCancel={draggable && !disabled ? reset : undefined}
      onMouseEnter={() => onHoverEvent(seg.event.id)}
      onMouseLeave={() => onHoverEvent(null)}
      title={disabled ? `${seg.event.title} — already happened` : seg.event.title}
      className={`absolute text-[10px] font-semibold truncate text-left px-1 transition-all ${baseClass} ${leftRadius} ${rightRadius} ${
        disabled ? 'opacity-40 cursor-default saturate-50' : lifted ? 'z-30 scale-105 opacity-90 shadow-lg' : seg.event.is_private ? 'opacity-50' : ''
      }`}
      style={{
        top: track * (TRACK_HEIGHT + TRACK_GAP),
        height: TRACK_HEIGHT,
        left: leftInset,
        right: rightInset,
        backgroundImage: isOwnDuty ? OWN_DUTY_STRIPE : undefined,
        boxShadow: lifted ? undefined : featuredShadow,
      }}
    >
      {seg.showTitle ? (
        <>
          {seg.event.is_private && <PrivateIcon className="inline-block w-2.5 h-2.5 align-text-bottom mr-0.5" />}
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
  courseCategories: { category: string; color: CourseColor }[]
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
            ? 'bg-white border-brand-900 text-brand-900'
            : 'bg-surface-100 border-surface-200 text-brand-950 font-medium line-through'
        }`}
      >
        <span className="w-2 h-2 rounded-full overflow-hidden flex" aria-hidden="true">
          <span className={`flex-1 ${DIVE_LOCAL_DOT}`} />
          <span className={`flex-1 ${DIVE_TRIP_DOT}`} />
        </span>
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
              ? 'bg-surface-100 border-surface-200 text-brand-950 font-medium line-through'
              : 'bg-white border-brand-900 text-brand-900'
          }`}
        >
          <span className="w-2 h-2 rounded-full overflow-hidden flex" aria-hidden="true">
            <span className={`flex-1 ${COURSE_DOT.ow}`} />
            <span className={`flex-1 ${COURSE_DOT.aow}`} />
            <span className={`flex-1 ${COURSE_DOT.dsd}`} />
            <span className={`flex-1 ${COURSE_DOT.rescue}`} />
            <span className={`flex-1 ${COURSE_DOT.specialty}`} />
          </span>
          Courses
          {hiddenCourses.size > 0 && !allCoursesHidden && (
            <span className="ml-0.5 text-[10px] text-brand-900 font-medium">({visibleCourses}/{courseCategories.length})</span>
          )}
          <span aria-hidden="true">▾</span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute left-0 top-full mt-1 z-20 min-w-[180px] bg-white border border-accent rounded-lg shadow-lg p-2 space-y-1"
          >
            {courseCategories.length === 0 && (
              <p className="text-brand-900 font-medium text-xs px-2 py-1">No courses in this range.</p>
            )}
            {courseCategories.map(({ category, color }) => {
              const shown = !hiddenCourses.has(category)
              return (
                <label
                  key={category}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={() => onToggleCategory(category)}
                    className="accent-brand-900"
                  />
                  <span className={`w-2 h-2 rounded-full ${COURSE_DOT[color]}`} aria-hidden="true" />
                  <span className="text-brand-900 text-xs font-semibold">{category}</span>
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
              ? 'bg-white border-brand-900 text-brand-900'
              : 'bg-surface-100 border-surface-200 text-brand-950 font-medium line-through'
          }`}
        >
          <span className={`w-2 h-2 rounded-full ${BUSY_DOT}`} />
          Busy
        </button>
      )}
    </div>
  )
}
