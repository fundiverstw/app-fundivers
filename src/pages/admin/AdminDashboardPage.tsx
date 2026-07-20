import { useEffect, useState } from 'react'
import { Spinner } from '../../components/ui/Spinner'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { EventKind } from '../../types/database'
import { usesCourseDays } from '../../lib/event-kinds'
import { EVENT_KIND_LABELS } from '../../lib/event-kind-labels'
import { errorMessage } from '../../lib/errors'
import { t } from '../../i18n'

const db = t.admin.dashboard
import { siteConfig } from '../../config/site'
import {
  computeDashboard,
  type Dashboard,
  type EventLite,
  type PaymentLite,
  type BookingLite,
  type ProfileLite,
  type ConfirmedCount,
} from '../../lib/admin-dashboard'
import { StatCard, ChartCard, BarList, ColumnChart } from '../../components/admin/dashboard-charts'
import { fiscalYearRange } from '../../lib/accounting-export'

// Admin BI dashboard. Pulls the current calendar year of payments + bookings,
// all profiles, and upcoming events, then computes every metric client-side
// (see src/lib/admin-dashboard.ts). The calendar-year axis (Jan→Dec) keeps the
// peak season (Jun–Aug) centred in the monthly charts. RLS already restricts
// these tables to admins. Asia/Taipei throughout.

function taipeiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: siteConfig.locale.timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
}

function taipeiYear(iso: string): number {
  return Number(taipeiDate(iso).slice(0, 4))
}

type DiveRow = { id: string; display_title: string | null; admin_title: string | null; capacity: number | null; start_date: string | null }
type CourseRow = { id: string; display_title: string | null; admin_title: string | null; capacity: number | null; course_days: string[] | null }
type EventRowLite = DiveRow & CourseRow & { kind: EventKind }

const titleOf = (r: { display_title: string | null; admin_title: string | null }, fallback: string) =>
  r.display_title || r.admin_title || fallback

function courseDateKey(days: string[] | null, today: string): string | null {
  const sorted = (days ?? []).map(d => d.slice(0, 10)).sort()
  if (!sorted.length) return null
  return sorted.find(d => d >= today) ?? sorted[sorted.length - 1]
}

async function loadDashboard(): Promise<Dashboard> {
  const nowIso = new Date().toISOString()
  const today = taipeiDate(nowIso)
  const { startIso, endIso } = fiscalYearRange(taipeiYear(nowIso))

  const [paymentsRes, bookingsRes, profilesRes, pendingRes, refundsRes, divesRes, coursesRes] = await Promise.all([
    supabase.from('payments').select('user_id, booking_id, amount, status, method, created_at').gte('created_at', startIso).lt('created_at', endIso),
    supabase.from('bookings').select('id, user_id, event_id, status, created_at, details').gte('created_at', startIso).lt('created_at', endIso),
    supabase.from('profiles').select('id, role, status, created_at, nationality, cert_level'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending').not('application_submitted_at', 'is', null),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).not('refund_requested_at', 'is', null).neq('status', 'cancelled'),
    supabase.from('events').select('id, display_title, admin_title, capacity, start_date').eq('kind', 'dive').is('cancelled_at', null).gte('start_date', today),
    supabase.from('events').select('id, display_title, admin_title, capacity, course_days').eq('kind', 'course').is('cancelled_at', null),
  ])
  if (paymentsRes.error) throw paymentsRes.error
  if (bookingsRes.error) throw bookingsRes.error
  if (profilesRes.error) throw profilesRes.error

  const payments = (paymentsRes.data ?? []) as PaymentLite[]
  const bookings = (bookingsRes.data ?? []) as BookingLite[]
  const profiles = (profilesRes.data ?? []) as ProfileLite[]
  const pendingApplications = pendingRes.count ?? 0
  const pendingRefundRequests = refundsRes.count ?? 0
  const upcomingDives = (divesRes.data ?? []) as DiveRow[]
  const allCourses = (coursesRes.data ?? []) as CourseRow[]

  // Event rows we still need titles for: events referenced by bookings that
  // aren't already in the upcoming-dives / all-courses sets we loaded.
  const knownIds = new Set([...upcomingDives.map(d => d.id), ...allCourses.map(c => c.id)])
  const refIds = [...new Set(bookings.map(b => b.event_id).filter((x): x is string => !!x && !knownIds.has(x)))]
  const extra = refIds.length
    ? (await supabase.from('events').select('id, kind, display_title, admin_title, capacity, start_date, course_days').in('id', refIds)).data as EventRowLite[] ?? []
    : []

  const events: EventLite[] = [
    ...upcomingDives.map((d): EventLite => ({
      id: d.id, type: 'dive', title: titleOf(d, t.calendar.typeDive), capacity: d.capacity,
      dateKey: d.start_date ? d.start_date.slice(0, 10) : null,
    })),
    ...allCourses.map((c): EventLite => ({
      id: c.id, type: 'course', title: titleOf(c, t.calendar.typeCourse), capacity: c.capacity,
      dateKey: courseDateKey(c.course_days, today),
    })),
    ...extra.map((e): EventLite => ({
      id: e.id, type: e.kind, title: titleOf(e, EVENT_KIND_LABELS[e.kind]), capacity: e.capacity,
      dateKey: usesCourseDays(e.kind) ? courseDateKey(e.course_days, today) : (e.start_date ? e.start_date.slice(0, 10) : null),
    })),
  ]

  // Confirmed counts for the genuinely-upcoming events (any-time bookings, not
  // just the trailing window) so fill rates are accurate.
  const upcomingIds = events.filter(e => e.dateKey && e.dateKey >= today).map(e => e.id)
  const confRes = upcomingIds.length
    ? await supabase.from('bookings').select('event_id').eq('status', 'confirmed').in('event_id', upcomingIds)
    : { data: [] as Array<{ event_id: string | null }> }
  const counts = new Map<string, number>()
  for (const r of confRes.data ?? []) if (r.event_id) counts.set(r.event_id, (counts.get(r.event_id) ?? 0) + 1)
  const confirmed: ConfirmedCount[] = [...counts.entries()].map(([eventId, count]) => ({ eventId, count }))

  return computeDashboard({ nowIso, payments, bookings, profiles, events, confirmed, pendingApplications, pendingRefundRequests })
}

const TWD = (n: number) => `${siteConfig.locale.currency} ${Math.round(n).toLocaleString()}`

export function AdminDashboardPage() {
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    loadDashboard()
      .then(d => { if (alive) setDash(d) })
      .catch(e => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [])

  if (error) {
    return <div className="max-w-5xl mx-auto"><p className="text-sm text-red-200 bg-red-900/40 border border-accent rounded-lg p-3">{error}</p></div>
  }
  if (!dash) {
    return (
      <div className="max-w-5xl mx-auto flex justify-center py-16">
        <Spinner className="w-6 h-6 border-2 border-surface-300" />
      </div>
    )
  }

  const k = dash.kpis
  const year = taipeiYear(new Date().toISOString())
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{db.title}</h1>
          <p className="text-sm text-white/70">{db.subtitle(year, siteConfig.locale.timezone)}</p>
        </div>
        <Link to="/admin/history" className="text-sm text-amber-300 hover:text-amber-200 shrink-0 mt-1">{db.historyLink}</Link>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={db.revenueThisMonth} value={TWD(k.netRevenueThisMonth)} />
        <StatCard label={db.revenueYear(year)} value={TWD(k.netRevenueYear)} />
        <StatCard label={db.bookingsThisMonth} value={k.bookingsThisMonth} sub={db.confirmedSub(k.confirmedBookingsThisMonth)} />
        <StatCard label={db.activeDivers} value={k.activeDivers} />
        <StatCard label={db.pendingApplications} value={k.pendingApplications} />
        {k.pendingRefundRequests > 0 ? (
          <Link to="/admin/refunds" className="block">
            <StatCard label={db.pendingRefundRequests} value={`${k.pendingRefundRequests} →`} />
          </Link>
        ) : (
          <StatCard label={db.pendingRefundRequests} value={k.pendingRefundRequests} />
        )}
        <StatCard label={db.upcomingEvents} value={k.upcomingEvents} />
        <StatCard label={db.avgFill} value={k.avgFillPct == null ? '—' : `${k.avgFillPct}%`} />
      </section>

      <section className="grid lg:grid-cols-2 gap-4">
        <ChartCard title={db.netRevenueByMonth} empty={dash.revenueByMonth.every(p => p.value === 0)}>
          <ColumnChart items={dash.revenueByMonth} kind="money" />
        </ChartCard>
        <ChartCard title={db.bookingsByMonth} empty={dash.bookingsByMonth.every(p => p.value === 0)}>
          <ColumnChart items={dash.bookingsByMonth} />
        </ChartCard>
        <ChartCard title={db.newDiversByMonth} empty={dash.signupsByMonth.every(p => p.value === 0)}>
          <ColumnChart items={dash.signupsByMonth} />
        </ChartCard>
        <ChartCard title={db.bookingsByStatus} empty={dash.bookingsByStatus.every(p => p.value === 0)}>
          <BarList items={dash.bookingsByStatus} />
        </ChartCard>
        <ChartCard title={db.revenueByMethod} empty={!dash.revenueByMethod.length}>
          <BarList items={dash.revenueByMethod} kind="money" />
        </ChartCard>
        <ChartCard title={db.revenueByEventType} empty={!dash.revenueByEventType.length}>
          <BarList items={dash.revenueByEventType} kind="money" />
        </ChartCard>
        <ChartCard title={db.revenueByNationality} empty={!dash.revenueByNationality.length}>
          <BarList items={dash.revenueByNationality} kind="money" />
        </ChartCard>
        <ChartCard title={db.revenueByCert} empty={!dash.revenueByCertLevel.length}>
          <BarList items={dash.revenueByCertLevel} kind="money" />
        </ChartCard>
        <ChartCard title={db.diversByCert} empty={!dash.certLevelMix.length}>
          <BarList items={dash.certLevelMix} />
        </ChartCard>
        <ChartCard title={db.topEventsByRevenue} empty={!dash.topEventsByRevenue.length}>
          <BarList items={dash.topEventsByRevenue} kind="money" />
        </ChartCard>
      </section>

      <ChartCard title={db.upcomingFill} empty={!dash.upcomingFill.length}>
        <div className="max-h-80 overflow-y-auto -mx-1 px-1">
          <table className="w-full text-xs text-brand-900">
            <thead className="text-brand-900/60 text-left">
              <tr>
                <th className="font-medium pb-1">{db.colEvent}</th>
                <th className="font-medium pb-1">{db.colDate}</th>
                <th className="font-medium pb-1 text-right">{db.colConfirmed}</th>
                <th className="font-medium pb-1 text-right">{db.colCapacity}</th>
                <th className="font-medium pb-1 text-right">{db.colFill}</th>
              </tr>
            </thead>
            <tbody>
              {dash.upcomingFill.map(r => (
                <tr key={`${r.type}:${r.id}`} className="border-t border-surface-100">
                  <td className="py-1 pr-2 truncate max-w-[14rem]">{r.title}</td>
                  <td className="py-1 pr-2 tabular-nums">{r.date ?? '—'}</td>
                  <td className="py-1 text-right tabular-nums">{r.confirmed}</td>
                  <td className="py-1 text-right tabular-nums">{r.capacity ?? '—'}</td>
                  <td className={`py-1 text-right tabular-nums ${r.fillPct != null && r.fillPct >= 100 ? 'text-red-600 font-semibold' : ''}`}>
                    {r.fillPct == null ? '—' : `${r.fillPct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  )
}
