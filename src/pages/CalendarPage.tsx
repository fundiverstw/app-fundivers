import { useEffect, useMemo, useRef, useState } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth,
  addMonths, subMonths, startOfWeek, endOfWeek,
} from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsInRange } from '../lib/events'
import { RegisterForm } from '../components/register/RegisterForm'
import { assignTracks, segmentsForDay, type CellSegment, type EventRange } from '../lib/calendar-layout'
import type { AppEvent, Booking } from '../types/database'

const TYPE_BAR: Record<AppEvent['type'], string> = {
  dive: 'bg-sky-500 hover:bg-sky-400 text-white',
  course: 'bg-emerald-500 hover:bg-emerald-400 text-white',
}
const TYPE_DOT: Record<AppEvent['type'], string> = {
  dive: 'bg-sky-500',
  course: 'bg-emerald-500',
}
const TYPE_LABELS: Record<AppEvent['type'], string> = {
  dive: 'Dive',
  course: 'Course',
}

// Short chip labels for the course-category filter popover. Falls back to the
// raw category string if a new course type shows up in the data.
const COURSE_SHORT: Record<string, string> = {
  'Open Water Course': 'OW',
  'Advanced Open Water': 'AOW',
  'PADI Rescue Course': 'Rescue',
  'EFR Course': 'EFR',
  'Equipment Course': 'Equipment',
  'Deep Specialty': 'Deep',
}
function courseShortLabel(category: string): string {
  return COURSE_SHORT[category] ?? category
}

const TRACK_HEIGHT = 18 // px per bar
const TRACK_GAP = 2     // px between bars

function fkFor(ev: AppEvent) {
  return ev.type === 'dive'
    ? { col: 'eo_dive_id' as const, payload: { eo_dive_id: ev.id, eo_course_id: null } }
    : { col: 'eo_course_id' as const, payload: { eo_dive_id: null, eo_course_id: ev.id } }
}

function bookingMatches(b: Booking, ev: AppEvent) {
  return ev.type === 'dive' ? b.eo_dive_id === ev.id : b.eo_course_id === ev.id
}

export function CalendarPage() {
  const { user, profile } = useAuth()
  const [month, setMonth] = useState(new Date())
  const [events, setEvents] = useState<AppEvent[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [selected, setSelected] = useState<AppEvent | null>(null)
  const [registering, setRegistering] = useState<AppEvent | null>(null)
  const [bookingLoading, setBookingLoading] = useState(false)

  // Filter state: Dive is a simple on/off; Courses is per-category. We track
  // hidden categories (not shown ones) so brand-new course types appearing in
  // the data are visible by default.
  const [diveShown, setDiveShown] = useState(true)
  const [hiddenCourses, setHiddenCourses] = useState<Set<string>>(new Set())

  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) })

  useEffect(() => {
    // Widen fetch by ±7 days so bars that begin/end outside the visible month
    // (but cross into it) still render continuously.
    const fromDate = new Date(startOfMonth(month).getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
    const toDate = new Date(endOfMonth(month).getTime() + 7 * 86_400_000).toISOString().slice(0, 10)
    fetchEventsInRange(fromDate, toDate).then(setEvents)
  }, [month])

  useEffect(() => {
    if (!user) return
    supabase
      .from('bookings')
      .select('*')
      .eq('user_id', user.id)
      .then(({ data }) => setBookings(data ?? []))
  }, [user])

  // Distinct course categories appearing in the fetched range. Drives the
  // Courses popover; sorted for stable ordering.
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

  // Max track used within *visible cells* determines cell height
  const cellTrackRows = useMemo(() => {
    let max = 0
    for (const r of ranges) {
      const monthStart = startOfMonth(month)
      const monthEnd = endOfMonth(month)
      if (r.end < monthStart || r.start > monthEnd) continue
      if (r.track + 1 > max) max = r.track + 1
    }
    return Math.min(max, 3) // cap visible tracks for mobile; overflow handled via +N more
  }, [ranges, month])

  const inMonthEvents = useMemo(
    () => filteredEvents.filter(e => isSameMonth(new Date(e.start_time), month) || (e.end_time && isSameMonth(new Date(e.end_time), month))),
    [filteredEvents, month]
  )

  function toggleCourseCategory(cat: string) {
    setHiddenCourses(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  function isBooked(ev: AppEvent) {
    return bookings.some(b => bookingMatches(b, ev) && b.status !== 'cancelled')
  }

  async function cancelBooking() {
    if (!user || !selected) return
    setBookingLoading(true)
    const { col } = fkFor(selected)
    await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('user_id', user.id)
      .eq(col, selected.id)
    setBookings(prev => prev.map(b =>
      bookingMatches(b, selected) ? { ...b, status: 'cancelled' } : b
    ))
    setBookingLoading(false)
  }

  function startRegister() {
    if (!selected) return
    setRegistering(selected)
    setSelected(null)
  }

  function handleBooked(booking: unknown) {
    setBookings(prev => [...prev, booking as Booking])
    setRegistering(null)
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <FilterLegend
        diveShown={diveShown}
        onToggleDive={() => setDiveShown(v => !v)}
        courseCategories={courseCategories}
        hiddenCourses={hiddenCourses}
        onToggleCategory={toggleCourseCategory}
      />

      <div className="flex items-center justify-between">
        <button onClick={() => setMonth(m => subMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">‹</button>
        <h1 className="text-lg font-bold text-slate-100">{format(month, 'MMMM yyyy')}</h1>
        <button onClick={() => setMonth(m => addMonths(m, 1))} className="p-2 text-slate-400 hover:text-slate-100">›</button>
      </div>

      <MonthGrid
        month={month}
        days={days}
        ranges={ranges}
        trackRows={cellTrackRows}
        onPickEvent={setSelected}
      />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">This month</h2>
        {inMonthEvents.length === 0 && (
          <p className="text-slate-500 text-sm">No events scheduled.</p>
        )}
        {inMonthEvents.map(ev => (
          <button
            key={ev.id}
            onClick={() => setSelected(ev)}
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
                  {format(new Date(ev.start_time), 'EEE, MMM d · HH:mm')}
                  {ev.end_time && ` → ${format(new Date(ev.end_time), 'MMM d')}`}
                </p>
              </div>
              {isBooked(ev) && (
                <span className="text-xs text-emerald-400 font-medium shrink-0">Booked</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {selected && (
        <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-slate-800 rounded-t-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className={`text-xs px-2 py-1 rounded-full text-white ${TYPE_DOT[selected.type]}`}>
                {TYPE_LABELS[selected.type]}
              </span>
              <button onClick={() => setSelected(null)} className="text-slate-400 text-xl leading-none">×</button>
            </div>
            <h2 className="text-xl font-bold text-slate-100">{selected.title}</h2>
            <div className="text-sm text-slate-400 space-y-1">
              <p>{format(new Date(selected.start_time), 'EEEE, MMMM d · HH:mm')}</p>
              {selected.end_time && (
                <p>Ends {format(new Date(selected.end_time), 'EEEE, MMMM d')}</p>
              )}
              {selected.price != null && (
                <p>💰 From {selected.currency} {selected.price.toLocaleString()}</p>
              )}
              {selected.fully_booked && <p className="text-rose-400">Fully booked</p>}
            </div>
            <button
              onClick={isBooked(selected) ? cancelBooking : startRegister}
              disabled={bookingLoading || (!isBooked(selected) && selected.fully_booked)}
              className={`w-full py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 ${
                isBooked(selected)
                  ? 'bg-slate-600 hover:bg-red-900 text-slate-200'
                  : 'bg-sky-500 hover:bg-sky-600 text-white'
              }`}
            >
              {bookingLoading ? '…' : isBooked(selected) ? 'Cancel booking' : 'Register'}
            </button>
          </div>
        </div>
      )}

      {registering && user && (
        <RegisterForm
          event={registering}
          profile={profile}
          userId={user.id}
          onClose={() => setRegistering(null)}
          onBooked={handleBooked}
        />
      )}
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
  // Leading padding so the first cell lines up under the correct weekday (Sun = 0).
  const leading = days[0].getDay()

  // Minimum cell height: day number row (22) + tracks * (row + gap).
  const cellMinHeight = 22 + Math.max(1, trackRows) * (TRACK_HEIGHT + TRACK_GAP) + 6

  return (
    // No grid gap — cells touch edge-to-edge so bars span continuously.
    // Week rows get a subtle top border via the DayCell itself.
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

  // Total number of overlapping events on this day regardless of trackRows cap
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
  const featuredRing = seg.event.featured ? 'ring-1 ring-amber-300' : ''
  // Leave a 2px inset on the true edges of the event so successive events on
  // adjacent days still look distinct. Middle cells use 0 inset so the bar
  // reads as one continuous pill across cell boundaries.
  const leftInset = seg.isStart ? 2 : 0
  const rightInset = seg.isEnd ? 2 : 0
  const leftRadius = seg.isStart ? 'rounded-l-sm' : ''
  const rightRadius = seg.isEnd ? 'rounded-r-sm' : ''

  return (
    <button
      type="button"
      onClick={onClick}
      title={seg.event.title}
      className={`absolute text-[10px] font-semibold truncate text-left px-1 ${baseClass} ${leftRadius} ${rightRadius} ${featuredRing}`}
      style={{
        top: track * (TRACK_HEIGHT + TRACK_GAP),
        height: TRACK_HEIGHT,
        left: leftInset,
        right: rightInset,
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
