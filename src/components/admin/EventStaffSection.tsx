import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { createDutyWithNotify, instructorsNeeded } from '../../lib/duties'
import { DUTY_ROLES, type Duty, type DutyRole, type Profile } from '../../types/database'

interface Props {
  eventType: 'dive' | 'course'
  eventId: string
  eventStartDate: string          // ISO timestamp
  eventEndDate?: string | null    // ISO timestamp; null for single-day events
  nonAdminDiverCount: number      // 1-per-5 instructor hint (courses only)
}

export function EventStaffSection({ eventType, eventId, eventStartDate, eventEndDate, nonAdminDiverCount }: Props) {
  const { user } = useAuth()
  const [duties, setDuties] = useState<Duty[]>([])
  const [admins, setAdmins] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)

  const eventStart = eventStartDate.slice(0, 10)
  const eventEnd = eventEndDate ? eventEndDate.slice(0, 10) : null
  const isMultiDay = !!eventEnd && eventEnd !== eventStart

  // Form state for the "assign" row. Date range defaults to the event's
  // full span; admins can narrow to specific days for multi-day events
  // (e.g. an instructor covering only day 2 of a 3-day course).
  const [assigneeId, setAssigneeId] = useState('')
  const [role, setRole] = useState<DutyRole>(eventType === 'course' ? 'instructor' : 'guide')
  const [startDate, setStartDate] = useState(eventStart)
  const [endDate, setEndDate] = useState(eventEnd ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fkColumn = eventType === 'dive' ? 'eo_dive_id' : 'eo_course_id'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [dutiesRes, adminsRes] = await Promise.all([
        supabase.from('duties').select('*').eq(fkColumn, eventId).order('role'),
        supabase.from('profiles').select('*').eq('role', 'admin').order('display_name'),
      ])
      if (cancelled) return
      setDuties(dutiesRes.data ?? [])
      setAdmins(adminsRes.data ?? [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [eventId, fkColumn])

  const adminMap = useMemo(() => new Map(admins.map(a => [a.id, a])), [admins])

  async function assign() {
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
    // Reset date range to event defaults for the next assignment.
    setStartDate(eventStart)
    setEndDate(eventEnd ?? '')
  }

  async function remove(id: string) {
    const { error } = await supabase.from('duties').delete().eq('id', id)
    if (error) { setErr(error.message); return }
    setDuties(prev => prev.filter(d => d.id !== id))
  }

  if (loading) return null

  const needed = eventType === 'course' ? instructorsNeeded(duties, nonAdminDiverCount) : 0

  return (
    <section className="bg-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Staff on duty</h2>
        {needed > 0 && (
          <span className="text-xs bg-rose-900/60 text-rose-200 px-2 py-0.5 rounded-full">
            Need {needed} more instructor{needed === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {duties.length === 0 ? (
        <p className="text-xs text-slate-500">Nobody assigned yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {duties.map(d => {
            const p = adminMap.get(d.assignee_id)
            const span = d.end_date && d.end_date !== d.start_date
              ? `${format(parseISO(d.start_date), 'MMM d')}–${format(parseISO(d.end_date), 'MMM d')}`
              : format(parseISO(d.start_date), 'MMM d')
            return (
              <li key={d.id} className="flex items-center justify-between text-xs bg-slate-900/40 rounded p-2">
                <span className="min-w-0">
                  <span className="font-medium text-slate-100">{p?.display_name || p?.full_name || '(unknown)'}</span>
                  <span className="text-slate-400"> · <span className="capitalize">{d.role}</span> · {span}</span>
                </span>
                <button
                  onClick={() => remove(d.id)}
                  className="text-slate-500 hover:text-rose-400 ml-2"
                  aria-label={`Remove duty for ${p?.display_name || p?.full_name || 'admin'}`}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="border-t border-slate-700 pt-3 space-y-2">
        <div className="flex gap-2">
          <select
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100"
          >
            <option value="">Pick admin…</option>
            {admins.map(a => (
              <option key={a.id} value={a.id}>{a.display_name || a.full_name || a.id}</option>
            ))}
          </select>
          <select
            value={role}
            onChange={e => setRole(e.target.value as DutyRole)}
            className="shrink-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-100 capitalize"
          >
            {DUTY_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="flex gap-2 items-center text-xs">
          <label className="text-slate-400 shrink-0">From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-100"
          />
          <label className="text-slate-400 shrink-0">to</label>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={e => setEndDate(e.target.value)}
            placeholder={isMultiDay ? 'end' : '(single day)'}
            className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-100"
          />
          <button
            onClick={assign}
            disabled={!assigneeId || !startDate || submitting}
            className="shrink-0 bg-sky-700 hover:bg-sky-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold px-3 py-1 rounded"
          >
            Assign
          </button>
        </div>
        {err && <p className="text-xs text-rose-400">{err}</p>}
      </div>
    </section>
  )
}
