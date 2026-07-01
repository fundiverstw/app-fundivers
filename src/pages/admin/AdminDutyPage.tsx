import { useEffect, useState } from 'react'
import { isoDate } from '../../lib/dates'
import { PageLoading } from '../../components/ui/Spinner'
import { personName } from '../../lib/names'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { fetchEventsInRange, formatEventSpan } from '../../lib/events'
import type { AppEvent, Duty, Profile } from '../../types/database'

type AdminMap = Map<string, Profile>

interface Enriched {
  duty: Duty
  assignee: Profile | null
  event: AppEvent | null
}

// The Duty tab answers three questions at a glance:
//   1. What am I on duty for?
//   2. Which events have nobody assigned yet?
//   3. What's on the roster overall?
export function AdminDutyPage() {
  const { user } = useAuth()
  const [duties, setDuties] = useState<Enriched[]>([])
  const [unstaffed, setUnstaffed] = useState<AppEvent[]>([])
  const [admins, setAdmins] = useState<AdminMap>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Load duties, admins, and the visible slice of events in parallel.
      // Range: 1 month back (to show recently-ended duties in "all") through
      // 3 months ahead (enough for course batches).
      const today = new Date()
      const start = new Date(today); start.setMonth(start.getMonth() - 1)
      const end = new Date(today); end.setMonth(end.getMonth() + 3)

      const [dutiesRes, adminsRes, events] = await Promise.all([
        supabase.from('duties').select('*').order('start_date', { ascending: true }),
        supabase.from('profiles').select('*').in('role', ['admin', 'staff']),
        fetchEventsInRange(isoDate(start), isoDate(end)),
      ])
      if (cancelled) return

      const adminMap = new Map((adminsRes.data ?? []).map(p => [p.id, p]))
      setAdmins(adminMap)

      const eventIndex = new Map(events.map(e => [e.id, e]))
      const enriched: Enriched[] = (dutiesRes.data ?? []).map(d => ({
        duty: d,
        assignee: adminMap.get(d.assignee_id) ?? null,
        event: (d.eo_dive_id && eventIndex.get(d.eo_dive_id))
          || (d.eo_course_id && eventIndex.get(d.eo_course_id))
          || null,
      }))
      setDuties(enriched)

      // Unstaffed = upcoming events (today or later) with no duty pointing at them.
      const coveredEventIds = new Set(
        (dutiesRes.data ?? []).flatMap(d => [d.eo_dive_id, d.eo_course_id].filter((x): x is string => !!x))
      )
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      setUnstaffed(events.filter(e =>
        !coveredEventIds.has(e.id) && new Date(e.start_time) >= todayStart
      ))

      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <PageLoading />
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  const upcoming = duties.filter(e => (e.duty.end_date ?? e.duty.start_date) >= today)
  const mine = user ? upcoming.filter(e => e.duty.assignee_id === user.id) : []

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-white">Duty roster</h1>
        <p className="text-xs text-white/70">
          {admins.size} assignable · {upcoming.length} upcoming
          {mine.length > 0 && <span className="text-red-300"> · {mine.length} for you</span>}
        </p>
      </header>

      {mine.length > 0 && (
        <Section title="Your upcoming duties" subtitle="You are on duty for these.">
          {mine.map(e => <DutyRow key={e.duty.id} enriched={e} highlight />)}
        </Section>
      )}

      {unstaffed.length > 0 && (
        <Section
          title="Unstaffed events"
          subtitle="Every event should have at least one admin assigned. Click an event to assign staff."
        >
          {unstaffed.map(ev => (
            <Link
              key={ev.id}
              to={`/admin/events/${ev.type}/${ev.id}`}
              className="block bg-white hover:bg-surface-100 rounded-xl p-3 border border-accent transition-colors"
            >
              <p className="text-sm font-medium text-brand-900">{ev.title}</p>
              <p className="text-xs text-brand-900 font-medium mt-0.5">
                {formatEventSpan(ev)}
                {' · '}
                <span className="capitalize">{ev.type}</span>
              </p>
            </Link>
          ))}
        </Section>
      )}

      <Section title="All upcoming duties" subtitle="Across the whole team.">
        {upcoming.length === 0
          ? <p className="text-brand-950 font-medium text-sm">No duties assigned.</p>
          : upcoming.map(e => <DutyRow key={e.duty.id} enriched={e} />)
        }
      </Section>
    </div>
  )
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">{title}</h2>
        {subtitle && <p className="text-xs text-white/60">{subtitle}</p>}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

const ROLE_STYLES: Record<string, string> = {
  instructor: 'bg-brand-900 text-white',
  guide:      'bg-brand-700 text-white',
  support:    'bg-surface-500 text-white',
}

function DutyRow({ enriched, highlight }: { enriched: Enriched; highlight?: boolean }) {
  const { duty, assignee, event } = enriched
  const dateSpan = duty.end_date && duty.end_date !== duty.start_date
    ? `${format(parseISO(duty.start_date), 'MMM d')} → ${format(parseISO(duty.end_date), 'MMM d')}`
    : format(parseISO(duty.start_date), 'EEE, MMM d')

  return (
    <div className={`bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-1 ${highlight ? 'border border-accent' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-brand-900 truncate">
            {personName(assignee?.name, assignee?.nickname) || '(unknown admin)'}
          </p>
          <p className="text-xs text-brand-900 font-medium">{dateSpan}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize shrink-0 ${ROLE_STYLES[duty.role] ?? ROLE_STYLES.support}`}>
          {duty.role}
        </span>
      </div>
      {event
        ? <Link to={`/admin/events/${event.type}/${event.id}`} className="block text-xs font-medium text-brand-900 hover:text-brand-700 underline truncate">
            {event.title}
          </Link>
        : (duty.eo_dive_id || duty.eo_course_id)
          ? <p className="text-xs text-brand-950 font-medium">(event outside visible range)</p>
          : <p className="text-xs text-brand-950 font-medium">Standalone duty</p>
      }
      {duty.notes && <p className="text-xs text-brand-900 font-medium bg-surface-50 rounded p-2 mt-1">📝 {duty.notes}</p>}
    </div>
  )
}
