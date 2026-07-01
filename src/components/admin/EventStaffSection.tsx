import { useEffect, useMemo, useState } from 'react'
import { personName } from '../../lib/names'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { createDutyWithNotify, instructorsNeeded } from '../../lib/duties'
import { DUTY_ROLES, type Duty, type DutyRole, type Profile } from '../../types/database'
import { DateField } from '../DateField'

interface Props {
  eventType: 'dive' | 'course'
  eventId: string
  eventStartDate: string          // ISO timestamp
  eventEndDate?: string | null    // ISO timestamp; null for single-day events
  nonAdminDiverCount: number      // 1-per-5 instructor hint (courses only)
  readOnly?: boolean              // staff: see assignments, but no assign/remove
}

export function EventStaffSection({ eventType, eventId, eventStartDate, eventEndDate, nonAdminDiverCount, readOnly }: Props) {
  const { user } = useAuth()
  const [duties, setDuties] = useState<Duty[]>([])
  const [admins, setAdmins] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  // IMPORTANT: format in the user's local timezone, not by slicing the UTC ISO
  // string. An event at midnight Taipei maps to the previous day in UTC, so
  // slice(0,10) would show the picker a day earlier than the calendar bar.
  const eventStart = format(parseISO(eventStartDate), 'yyyy-MM-dd')
  const eventEnd = eventEndDate ? format(parseISO(eventEndDate), 'yyyy-MM-dd') : null
  const isMultiDay = !!eventEnd && eventEnd !== eventStart

  // Form state for the "assign" row.
  const [assigneeId, setAssigneeId] = useState('')
  const [role, setRole] = useState<DutyRole>(eventType === 'course' ? 'instructor' : 'guide')
  // Dives use a date range (contiguous span); admins can narrow to a subset
  // of days for multi-day dives.
  const [startDate, setStartDate] = useState(eventStart)
  const [endDate, setEndDate] = useState(eventEnd ?? '')
  // Courses run on an explicit (possibly non-consecutive) day list, so duty
  // days are picked one-by-one from those days rather than as a From/To
  // range. Each selected day becomes its own single-day duty.
  const [courseDays, setCourseDays] = useState<string[]>([])
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fkColumn = eventType === 'dive' ? 'eo_dive_id' : 'eo_course_id'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [dutiesRes, adminsRes, courseRes] = await Promise.all([
        supabase.from('duties').select('*').eq(fkColumn, eventId).order('role'),
        supabase.from('profiles').select('*').in('role', ['admin', 'staff']).order('name'),
        eventType === 'course'
          ? supabase.from('EO_courses').select('course_days').eq('_id', eventId).single()
          : Promise.resolve({ data: null }),
      ])
      if (cancelled) return
      setDuties(dutiesRes.data ?? [])
      setAdmins(adminsRes.data ?? [])
      if (eventType === 'course') {
        const days = [...((courseRes.data?.course_days as string[] | null) ?? [])]
          .filter(Boolean).sort()
        setCourseDays(days)
        setSelectedDays(days)  // default: staff covers the whole course
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [eventId, fkColumn, eventType])

  const adminMap = useMemo(() => new Map(admins.map(a => [a.id, a])), [admins])

  // Dives: one duty over the chosen [start, end] range.
  async function assignDive() {
    if (!user || !assigneeId || !startDate) return
    if (endDate && endDate < startDate) { setErr('End date must be on or after start date'); return }
    setSubmitting(true); setErr(null)
    const { duty, error } = await createDutyWithNotify({
      assignee_id: assigneeId,
      role,
      start_date: startDate,
      end_date: endDate || null,
      [fkColumn]: eventId,
    } as Parameters<typeof createDutyWithNotify>[0], user.id)
    setSubmitting(false)
    if (error || !duty) { setErr(error?.message ?? 'Failed to assign'); return }
    setDuties(prev => [...prev, duty])
    setAssigneeId('')
    setStartDate(eventStart)
    setEndDate(eventEnd ?? '')
  }

  // Courses: one single-day duty per selected day (days may be
  // non-consecutive, so a single range can't represent them).
  async function assignCourse() {
    if (!user || !assigneeId) return
    const days = [...selectedDays].sort()
    if (!days.length) { setErr('Pick at least one day'); return }
    setSubmitting(true); setErr(null)
    const created: Duty[] = []
    try {
      for (const day of days) {
        const { duty, error } = await createDutyWithNotify({
          assignee_id: assigneeId,
          role,
          start_date: day,
          end_date: null,
          [fkColumn]: eventId,
        } as Parameters<typeof createDutyWithNotify>[0], user.id)
        if (error || !duty) throw error ?? new Error('Failed to assign')
        created.push(duty)
      }
      setAssigneeId('')
      setSelectedDays([...courseDays])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      if (created.length) setDuties(prev => [...prev, ...created])
      setSubmitting(false)
    }
  }

  const assign = eventType === 'course' ? assignCourse : assignDive

  function toggleDay(day: string) {
    setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  async function remove(id: string) {
    const { error } = await supabase.from('duties').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    setDuties(prev => prev.filter(d => d.id !== id))
  }

  if (loading) return null

  const needed = eventType === 'course' ? instructorsNeeded(duties, nonAdminDiverCount) : 0

  return (
    <section className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-brand-900">Staff on duty</h2>
        {needed > 0 && (
          <span className="text-xs bg-red-100 text-red-700 border border-accent px-2 py-0.5 rounded-full">
            Need {needed} more instructor{needed === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {duties.length === 0 ? (
        <p className="text-xs text-brand-950 font-medium">Nobody assigned yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {duties.map(d => {
            const p = adminMap.get(d.assignee_id)
            const span = d.end_date && d.end_date !== d.start_date
              ? `${format(parseISO(d.start_date), 'MMM d')}–${format(parseISO(d.end_date), 'MMM d')}`
              : format(parseISO(d.start_date), 'MMM d')
            return (
              <li key={d.id} className="flex items-center justify-between text-xs bg-surface-50 rounded p-2">
                <span className="min-w-0">
                  <span className="font-medium text-brand-900">{personName(p?.name, p?.nickname) || '(unknown)'}</span>
                  <span className="text-brand-900 font-medium"> · <span className="capitalize">{d.role}</span> · {span}</span>
                </span>
                {!readOnly && (
                  <button
                    onClick={() => remove(d.id)}
                    className="text-brand-950 font-medium hover:text-red-600 ml-2"
                    aria-label={`Remove duty for ${personName(p?.name, p?.nickname) || 'admin'}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly && (
      <div className="border-t border-surface-200 pt-3 space-y-2">
        <div className="flex gap-2">
          <select
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            className="flex-1 min-w-0 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900"
          >
            <option value="">Pick admin/staff…</option>
            {admins.map(a => (
              <option key={a.id} value={a.id}>{personName(a.name, a.nickname) || a.id}</option>
            ))}
          </select>
          <select
            value={role}
            onChange={e => setRole(e.target.value as DutyRole)}
            className="shrink-0 bg-white border border-surface-300 rounded px-2 py-1 text-xs text-brand-900 capitalize"
          >
            {DUTY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="space-y-2 text-xs">
          {eventType === 'course' ? (
            // Pick which course days this person is on duty for. Each
            // selected day becomes its own single-day duty.
            <div className="space-y-1">
              <span className="text-brand-900 font-medium">Days on duty</span>
              <div className="flex flex-wrap gap-1.5">
                {courseDays.map(day => {
                  const on = selectedDays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleDay(day)}
                      className={`px-2 py-1 rounded border font-medium ${
                        on
                          ? 'bg-surface-700 text-white border-surface-700'
                          : 'bg-white text-brand-900 border-surface-300 hover:bg-surface-50'
                      }`}
                    >
                      {format(parseISO(day), 'EEE, MMM d')}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2">
                <span className="text-brand-900 font-medium shrink-0 w-12">{isMultiDay ? 'From' : 'Date'}</span>
                <DateField
                  value={startDate}
                  min={eventStart}
                  max={eventEnd ?? eventStart}
                  onChange={setStartDate}
                  className="flex-1 min-w-0 bg-white border border-surface-300 rounded px-2 py-1 text-brand-900"
                />
              </label>
              {isMultiDay && (
                <label className="flex items-center gap-2">
                  <span className="text-brand-900 font-medium shrink-0 w-12">To</span>
                  <DateField
                    value={endDate}
                    min={startDate}
                    max={eventEnd ?? eventStart}
                    onChange={setEndDate}
                    className="flex-1 min-w-0 bg-white border border-surface-300 rounded px-2 py-1 text-brand-900"
                  />
                </label>
              )}
            </>
          )}
          <button
            onClick={assign}
            disabled={!assigneeId || submitting || (eventType === 'course' ? selectedDays.length === 0 : !startDate)}
            className="w-full bg-surface-700 hover:bg-surface-600 disabled:bg-surface-100 disabled:text-brand-950 font-medium text-white font-semibold px-3 py-1.5 rounded"
          >
            Assign
          </button>
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
      )}
    </section>
  )
}
