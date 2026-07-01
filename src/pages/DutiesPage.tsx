import { useEffect, useState } from 'react'
import { isoDate } from '../lib/dates'
import { PageLoading } from '../components/ui/Spinner'
import { Link } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { fetchEventsInRange, formatEventSpan } from '../lib/events'
import type { AppEvent, Duty } from '../types/database'
import { PAGE_BODY } from '../styles/tokens'

interface Enriched {
  duty: Duty
  event: AppEvent | null
}

const ROLE_STYLES: Record<string, string> = {
  instructor: 'bg-brand-900 text-white',
  guide:      'bg-brand-700 text-white',
  support:    'bg-surface-500 text-white',
}

// "My duties" — visible to authenticated users who have any assigned
// duties. Staff and admin both reach this; divers in practice never
// have rows here (the duties trigger blocks non-staff/admin assignees).
// Admins also have /admin/duty for the team-wide roster.
export function DutiesPage() {
  const { user, profile } = useAuth()
  const [enriched, setEnriched] = useState<Enriched[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    ;(async () => {
      const today = new Date()
      const start = new Date(today); start.setMonth(start.getMonth() - 1)
      const end = new Date(today); end.setMonth(end.getMonth() + 3)

      const [dutiesRes, events] = await Promise.all([
        supabase.from('duties').select('*').eq('assignee_id', user.id).order('start_date', { ascending: true }),
        fetchEventsInRange(isoDate(start), isoDate(end)),
      ])
      if (cancelled) return

      const eventIndex = new Map(events.map(e => [e.id, e]))
      setEnriched((dutiesRes.data ?? []).map(d => ({
        duty: d,
        event: (d.eo_dive_id && eventIndex.get(d.eo_dive_id))
          || (d.eo_course_id && eventIndex.get(d.eo_course_id))
          || null,
      })))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [user])

  if (loading) {
    return <PageLoading />
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  const upcoming = enriched.filter(e => (e.duty.end_date ?? e.duty.start_date) >= today)
  const past     = enriched.filter(e => (e.duty.end_date ?? e.duty.start_date) <  today)

  // Staff and admin can deep-link to event detail pages; divers can't.
  const eventLinkBase = profile?.role === 'admin' || profile?.role === 'staff' ? '/admin/events' : null

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-white">My duties</h1>
        <p className="text-xs text-white/70">
          {upcoming.length} upcoming · {past.length} past
        </p>
      </header>

      <Section title="Upcoming">
        {upcoming.length === 0
          ? <p className={`${PAGE_BODY} text-sm`}>Nothing scheduled.</p>
          : upcoming.map(e => <Row key={e.duty.id} e={e} eventLinkBase={eventLinkBase} />)
        }
      </Section>

      {past.length > 0 && (
        <Section title="Past">
          {past.map(e => <Row key={e.duty.id} e={e} eventLinkBase={eventLinkBase} dim />)}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Row({ e, eventLinkBase, dim }: { e: Enriched; eventLinkBase: string | null; dim?: boolean }) {
  const { duty, event } = e
  const dateSpan = duty.end_date && duty.end_date !== duty.start_date
    ? `${format(parseISO(duty.start_date), 'MMM d')} → ${format(parseISO(duty.end_date), 'MMM d')}`
    : format(parseISO(duty.start_date), 'EEE, MMM d')

  return (
    <div className={`bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-3 space-y-1 ${dim ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-brand-900 font-medium">{dateSpan}</p>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize shrink-0 ${ROLE_STYLES[duty.role] ?? ROLE_STYLES.support}`}>
          {duty.role}
        </span>
      </div>
      {event && eventLinkBase
        ? <Link to={`${eventLinkBase}/${event.type}/${event.id}`} className="block text-sm font-medium text-brand-900 hover:text-brand-950 truncate">
            {event.title} <span className="text-xs text-brand-900/70 font-normal">· {formatEventSpan(event)}</span>
          </Link>
        : event
          ? <p className="text-sm font-medium text-brand-900 truncate">{event.title}</p>
          : (duty.eo_dive_id || duty.eo_course_id)
            ? <p className="text-xs text-brand-950 font-medium">(event outside visible range)</p>
            : <p className="text-xs text-brand-950 font-medium">Standalone duty</p>
      }
      {duty.notes && <p className="text-xs text-brand-900 font-medium bg-surface-50 rounded p-2 mt-1">📝 {duty.notes}</p>}
    </div>
  )
}
