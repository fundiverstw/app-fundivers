import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../hooks/useToast'
import { errorMessage } from '../../lib/errors'
import { personName } from '../../lib/names'
import {
  fetchContinuableCourses, createCourseContinuation, attendDayKeys, dayKeyOf, dayLabel,
  type ContinuableCourse,
} from '../../lib/course-continuation'
import type { AppEvent, Profile } from '../../types/database'
import { MODAL_BACKDROP, TEXT_HEADING, TEXT_BODY, INPUT, BTN_PRIMARY, BTN_XS_GHOST } from '../../styles/tokens'
import { t } from '../../i18n'

const cn = t.admin.continuation
const pf = t.profile.family

// "This diver started Open Water on the 10th and is finishing it here."
//
// Three steps, each answering one question: who, which course did they start,
// and which days are they here for. The last step also offers to trim the
// original booking to the days they actually attended — without that, the
// course they walked away from keeps counting them for gear and headcount on
// days they were never there.
//
// Everything that makes the pairing legal (subset of the course's days, no
// double-booking, admin only) is enforced by the create_course_continuation
// RPC. This form's job is to make the legal thing easy to express.
export function CourseContinuationModal({ event, onClose, onAdded }: {
  /** The course being continued *onto* — the event whose page we're on. */
  event: AppEvent
  onClose: () => void
  onAdded: () => void
}) {
  const toast = useToast()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [filter, setFilter] = useState('')
  const [target, setTarget] = useState<Profile | null>(null)
  const [courses, setCourses] = useState<ContinuableCourse[] | null>(null)
  const [source, setSource] = useState<ContinuableCourse | null>(null)
  const [targetDays, setTargetDays] = useState<string[]>([])
  const [sourceDays, setSourceDays] = useState<string[]>([])
  const [eventDays, setEventDays] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // This event as an AppEvent carries rendered segments, not the raw day list,
  // so the days to offer come from the row itself.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('events').select('course_days').eq('id', event.id).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const days = ((data as { course_days: string[] | null } | null)?.course_days ?? [])
          .map(dayKeyOf).filter((d): d is string => !!d).sort()
        setEventDays(days)
        // If the admin got to the day step before this landed, tick the days
        // for them rather than showing an empty picker they must fill in.
        setTargetDays(prev => (prev.length ? prev : days))
      })
    return () => { cancelled = true }
  }, [event.id])

  useEffect(() => {
    let cancelled = false
    supabase.from('profiles').select('*').order('name', { ascending: true })
      .then(({ data }) => { if (!cancelled) setProfiles((data ?? []) as Profile[]) })
    return () => { cancelled = true }
  }, [])

  // `courses` is cleared where the diver changes, not here: resetting it
  // inside the effect would be a synchronous setState on every run.
  useEffect(() => {
    if (!target) return
    let cancelled = false
    fetchContinuableCourses(target.id, event.id)
      .then(rows => { if (!cancelled) setCourses(rows) })
      .catch(err => { if (!cancelled) { setCourses([]); setError(errorMessage(err)) } })
    return () => { cancelled = true }
  }, [target, event.id])

  function pickSource(c: ContinuableCourse) {
    setSource(c)
    setError(null)
    // Default to every remaining day here, and to whatever the original
    // booking already claims (all of them, for a booking made before this
    // existed) there — the common edit is unticking one, not building both
    // lists from nothing.
    setTargetDays(eventDays)
    const already = attendDayKeys(c.booking)
    setSourceDays(already.length ? already : c.courseDays)
  }

  function toggle(day: string, list: string[], set: (v: string[]) => void) {
    set(list.includes(day) ? list.filter(d => d !== day) : [...list, day].sort())
  }

  async function submit() {
    if (!source) return
    if (targetDays.length === 0) { setError(cn.noDaysPicked); return }
    if (sourceDays.length === 0) { setError(cn.noDaysPicked); return }
    setSaving(true)
    setError(null)
    try {
      await createCourseContinuation({
        sourceBookingId: source.booking.id,
        eventId: event.id,
        days: targetDays,
        // Only send a trim when it actually narrows the original, so an
        // untouched booking keeps its "all days" NULL.
        ...(sourceDays.length < source.courseDays.length ? { sourceDays } : {}),
      })
      toast.success(cn.added)
      onAdded()
      onClose()
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      toast.error(`${cn.failed}: ${msg}`)
    } finally {
      setSaving(false)
    }
  }

  const visible = profiles.filter(p => {
    if (!filter) return true
    const haystack = [p.name, p.nickname, p.contact_id].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(filter.toLowerCase())
  })
  const targetName = target ? personName(target.name, target.nickname) || pf.noName : ''

  return (
    <div
      className={`${MODAL_BACKDROP} flex items-start justify-center p-4 pt-8 overflow-y-auto`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="continuation-title"
      onClick={onClose}
    >
      <div
        className="bg-white/80 backdrop-blur-md border border-accent rounded-2xl w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 id="continuation-title" className={`text-lg ${TEXT_HEADING}`}>{cn.title}</h2>
          <button onClick={onClose} className="text-brand-900 font-medium text-xl leading-none" aria-label={cn.close}>×</button>
        </header>

        <p className={`text-sm ${TEXT_BODY}`}>{cn.intro}</p>

        {!target && (
          <>
            <p className="text-xs font-semibold text-brand-700 uppercase tracking-wider">{cn.pickDiver}</p>
            <input
              type="text"
              autoFocus
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={cn.searchPlaceholder}
              className={`${INPUT} text-sm`}
            />
            <ul className="space-y-1 max-h-72 overflow-y-auto">
              {visible.map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => { setCourses(null); setTarget(p) }}
                    className="w-full text-left bg-white/70 hover:bg-surface-100 border border-surface-200 rounded-lg px-3 py-2"
                  >
                    <p className="text-sm font-medium text-brand-900">{personName(p.name, p.nickname) || pf.noName}</p>
                    <p className="text-xs text-brand-900/70">{p.contact_id ?? ''}</p>
                  </button>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="text-sm text-brand-900/80 italic px-1">{cn.noMatchingDivers}</li>
              )}
            </ul>
          </>
        )}

        {target && (
          <button type="button" onClick={() => { setTarget(null); setSource(null); setCourses(null) }} className={BTN_XS_GHOST}>
            {t.admin.addDiver.pickDifferentDiver}
          </button>
        )}

        {target && !source && (
          <>
            <p className="text-xs font-semibold text-brand-700 uppercase tracking-wider">{cn.pickBooking}</p>
            {courses === null && <p className={`text-sm ${TEXT_BODY}`}>…</p>}
            {courses?.length === 0 && (
              <p className="text-sm text-brand-900/80 italic">{cn.noCourseBookings(targetName)}</p>
            )}
            <ul className="space-y-1">
              {(courses ?? []).map(c => (
                <li key={c.booking.id}>
                  <button
                    type="button"
                    onClick={() => pickSource(c)}
                    className="w-full text-left bg-white/70 hover:bg-surface-100 border border-surface-200 rounded-lg px-3 py-2"
                  >
                    <p className="text-sm font-medium text-brand-900">{c.title}</p>
                    <p className="text-xs text-brand-900/70">{c.courseDays.map(dayLabel).join(' · ')}</p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {target && source && (
          <>
            <DayPicker
              legend={cn.daysHere}
              days={eventDays}
              selected={targetDays}
              onToggle={d => toggle(d, targetDays, setTargetDays)}
            />
            <DayPicker
              legend={cn.daysThere}
              hint={cn.daysThereHint}
              days={source.courseDays}
              selected={sourceDays}
              onToggle={d => toggle(d, sourceDays, setSourceDays)}
            />
            <p className="text-xs text-brand-900/80">{cn.noCharge}</p>
            {error && <p className="text-sm text-red-700 bg-red-50 border border-accent rounded p-2">{error}</p>}
            <button type="button" onClick={submit} disabled={saving} className={`w-full ${BTN_PRIMARY}`}>
              {saving ? cn.submitting : cn.submit}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function DayPicker({ legend, hint, days, selected, onToggle }: {
  legend: string
  hint?: string
  days: string[]
  selected: string[]
  onToggle: (day: string) => void
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold text-brand-700 uppercase tracking-wider">{legend}</legend>
      {hint && <p className="text-xs text-brand-900/70">{hint}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        {days.map(d => (
          <label key={d} className="flex items-center gap-1.5 text-sm text-brand-900 bg-white/70 border border-surface-200 rounded-lg px-2 py-1">
            <input type="checkbox" checked={selected.includes(d)} onChange={() => onToggle(d)} />
            {dayLabel(d)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
