import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { siteConfig } from '../../config/site'
import { errorMessage } from '../../lib/errors'
import { todayIso } from '../../lib/dates'
import { BTN_XS_BASE, ERROR_NOTE_LIGHT } from '../../styles/tokens'
import { EVENT_KIND_LABELS } from '../../lib/event-kind-labels'
import {
  buildStaffRevenue,
  type PersonRevenue,
  type RevenueBooking,
  type RevenueDuty,
  type RevenueEvent,
  type RevenuePayment,
  type RevenuePerson,
  type StaffRevenueReport,
} from '../../lib/staff-revenue'
import { t } from '../../i18n'

const r = t.admin.revenue
const CUR = siteConfig.locale.currencyLabel
const EVENT_COLUMNS = 'id, kind, admin_title, display_title, start_date, end_date, course_days, cancelled_at'
const FIELD = 'w-full bg-white border border-surface-300 rounded-md px-3 py-2 text-sm text-brand-900 focus:outline-none focus:border-brand-900'

function money(n: number): string {
  return `${CUR} ${Math.round(n).toLocaleString()}`
}

/**
 * Load everything buildStaffRevenue needs for one season.
 *
 * `scopeToPersonId` is set for a staff viewer, and narrows the fetch to the
 * events they were actually on — not just the display. RLS lets staff read the
 * whole payments ledger, so this is not a security boundary, but there is no
 * reason to pull the shop's entire book of business into a guide's browser to
 * render their own five rows. Co-crew duties on those same events still come
 * back, because the split denominator needs them.
 */
async function loadSeason(
  season: number,
  scopeToPersonId: string | null,
): Promise<{
  events: RevenueEvent[]
  duties: RevenueDuty[]
  bookings: RevenueBooking[]
  payments: RevenuePayment[]
  people: RevenuePerson[]
}> {
  const jan1 = `${season}-01-01`
  const dec31 = `${season}-12-31`

  let events: RevenueEvent[]
  if (scopeToPersonId) {
    const { data: mine, error } = await supabase
      .from('duties')
      .select('event_id')
      .eq('assignee_id', scopeToPersonId)
      .not('event_id', 'is', null)
    if (error) throw error
    const ids = [...new Set((mine ?? []).map(d => d.event_id).filter((x): x is string => !!x))]
    if (!ids.length) return { events: [], duties: [], bookings: [], payments: [], people: [] }
    const { data, error: evErr } = await supabase.from('events').select(EVENT_COLUMNS).in('id', ids)
    if (evErr) throw evErr
    events = (data ?? []) as RevenueEvent[]
  } else {
    // Kinds on the date envelope carry start_date, so the season filter lands
    // in the query and keeps the bulk of the table out of the response.
    // Course-day kinds keep their dates in an array column no range filter
    // reaches, so they come back whole — they are far the smaller set — and
    // buildStaffRevenue drops the out-of-season ones.
    const { data, error } = await supabase.from('events').select(EVENT_COLUMNS)
      .or(`and(start_date.gte.${jan1},start_date.lte.${dec31}),course_days.not.is.null`)
    if (error) throw error
    events = (data ?? []) as RevenueEvent[]
  }

  const eventIds = events.map(e => e.id)
  if (!eventIds.length) return { events, duties: [], bookings: [], payments: [], people: [] }

  const [dutyRes, bookingRes, peopleRes] = await Promise.all([
    supabase.from('duties').select('event_id, assignee_id, role').in('event_id', eventIds),
    supabase.from('bookings').select('id, event_id, status').in('event_id', eventIds).eq('status', 'confirmed'),
    supabase.from('profiles').select('id, name, nickname').in('role', ['admin', 'staff']),
  ])
  if (dutyRes.error) throw dutyRes.error
  if (bookingRes.error) throw bookingRes.error
  if (peopleRes.error) throw peopleRes.error

  const bookings = (bookingRes.data ?? []) as RevenueBooking[]
  const bookingIds = bookings.map(b => b.id)
  const payRes = bookingIds.length
    ? await supabase.from('payments').select('booking_id, status, amount').in('booking_id', bookingIds)
    : { data: [], error: null }
  if (payRes.error) throw payRes.error

  return {
    events,
    duties: (dutyRes.data ?? []) as RevenueDuty[],
    bookings,
    payments: (payRes.data ?? []).map(p => ({ ...p, amount: Number(p.amount) || 0 })) as RevenuePayment[],
    people: (peopleRes.data ?? []) as RevenuePerson[],
  }
}

function PersonBreakdown({ person }: { person: PersonRevenue }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-900/70">{r.breakdownMonths}</h4>
        {/* table-fixed rather than a min-width scroll container: five short
            columns fit the narrowest phone once the numerics stop claiming
            their natural width, and a table that fits beats one that scrolls
            sideways inside a card. */}
        <table className="w-full table-fixed text-sm text-brand-900">
          <colgroup>
            <col />
            <col className="w-[3.2rem]" />
            <col className="w-[3.2rem]" />
            <col className="w-[3.2rem]" />
            <col className="w-[6.5rem]" />
          </colgroup>
          <thead>
            <tr className="text-left text-xs text-brand-900/60">
              <th className="py-1 pr-3 font-medium">{r.colMonth}</th>
              <th className="py-1 pr-3 font-medium text-right">{r.colCourses}</th>
              <th className="py-1 pr-3 font-medium text-right">{r.colDives}</th>
              <th className="py-1 pr-3 font-medium text-right">{r.colStudents}</th>
              <th className="py-1 font-medium text-right">{r.colCollected}</th>
            </tr>
          </thead>
          <tbody>
            {person.months.map(m => (
              <tr key={m.month} className="border-t border-surface-200">
                <td className="py-1 pr-3">{m.month}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{m.taughtEvents}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{m.ledEvents}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{m.students}</td>
                <td className="py-1 text-right tabular-nums font-semibold">{money(m.collected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-1">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-900/70">{r.breakdownTypes}</h4>
        <ul className="text-sm text-brand-900 space-y-0.5">
          {person.categories.map(c => (
            <li key={`${c.kind}:${c.category}`} className="flex justify-between gap-3 border-t border-surface-200 py-1">
              <span>
                {c.category || EVENT_KIND_LABELS[c.kind]}
                <span className="text-brand-900/60"> · {c.events} · {c.students}</span>
              </span>
              <span className="tabular-nums font-semibold">{money(c.collected)}</span>
            </li>
          ))}
        </ul>
      </div>

      {person.upcoming.events > 0 && (
        <p className="text-[11px] text-brand-900/70">
          {r.upcoming(money(person.upcoming.collected), person.upcoming.events)}
        </p>
      )}
    </div>
  )
}

function UnattributedBlock({ report }: { report: StaffRevenueReport }) {
  const [open, setOpen] = useState(false)
  if (!report.unattributed.events.length) return null
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold text-amber-900">{r.unattributed}</span>
        <span className="text-sm font-semibold text-amber-900 tabular-nums">{money(report.unattributed.collected)}</span>
      </div>
      <p className="text-xs text-amber-900/80">{r.unattributedBlurb(report.unattributed.events.length)}</p>
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`${BTN_XS_BASE} bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300`}>
        {open ? r.unattributedHide : r.unattributedShow}
      </button>
      {open && (
        <ul className="text-xs text-amber-900 space-y-0.5 pt-1">
          {report.unattributed.events.map(e => (
            <li key={e.eventId} className="flex justify-between gap-3 border-t border-amber-200 py-1">
              <Link to={`/admin/events/${e.eventId}`} className="underline hover:no-underline truncate">
                {e.firstDay} · {e.title}
              </Link>
              <span className="tabular-nums shrink-0">{money(e.collected)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export interface StaffRevenuePanelProps {
  /** Set for a staff viewer: the page shows only this person's figures and
   *  fetches only the events they worked. Null for an admin, who sees the
   *  whole crew plus the unattributed bucket. */
  selfOnlyPersonId: string | null
}

export function StaffRevenuePanel({ selfOnlyPersonId }: StaffRevenuePanelProps) {
  const thisYear = Number(todayIso().slice(0, 4))
  const years = useMemo(() => Array.from({ length: 5 }, (_, i) => thisYear - i), [thisYear])
  const [season, setSeason] = useState(thisYear)
  const [openPersonId, setOpenPersonId] = useState<string | null>(null)
  /** Admin crew filter: '' shows the whole-crew comparison, an id narrows to
   *  one person's season. */
  const [pickedPersonId, setPickedPersonId] = useState('')
  // One state slot stamped with the fetch it answers, rather than separate
  // report/error/loading flags reset at the top of the effect. Loading is then
  // "the answer I hold is not for the season I'm showing", which is true from
  // the first render and needs no synchronous setState inside the effect.
  const [answer, setAnswer] = useState<{
    key: string
    report?: StaffRevenueReport
    /** Every admin/staff profile, not just those with attributed revenue —
     *  the crew picker has to offer someone before you can discover they
     *  earned nothing this season. */
    roster?: RevenuePerson[]
    error?: string
  } | null>(null)
  const key = `${season}|${selfOnlyPersonId ?? ''}`

  useEffect(() => {
    let cancelled = false
    loadSeason(season, selfOnlyPersonId)
      .then(input => {
        if (cancelled) return
        setAnswer({ key, roster: input.people, report: buildStaffRevenue({ season, today: todayIso(), ...input }) })
      })
      .catch(err => { if (!cancelled) setAnswer({ key, error: errorMessage(err) }) })
    return () => { cancelled = true }
  }, [season, selfOnlyPersonId, key])

  const current = answer?.key === key ? answer : null
  const loading = !current
  const error = current?.error ?? null
  const report = current?.report ?? null

  const people = report
    ? (selfOnlyPersonId ? report.people.filter(p => p.personId === selfOnlyPersonId) : report.people)
    : []
  const self = selfOnlyPersonId ? people[0] ?? null : null
  const roster = [...(current?.roster ?? [])].sort((a, b) =>
    (a.nickname || a.name || '').localeCompare(b.nickname || b.name || ''))
  const picked = pickedPersonId ? people.find(p => p.personId === pickedPersonId) ?? null : null

  return (
    <div className="space-y-4">
      <p className="text-sm text-white/80">{selfOnlyPersonId ? r.blurbSelf : r.blurb}</p>

      <div className="bg-white/70 backdrop-blur-md border border-surface-200 rounded-xl p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-brand-900">{r.season}</span>
            <select
              value={season}
              onChange={e => { setSeason(Number(e.target.value)); setOpenPersonId(null) }}
              className={FIELD}
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>

          {/* Crew picker, admin only. The comparison table doubles as a
              selector — click a name to expand it — but that is invisible when
              a season has no attributed revenue yet, which is exactly when an
              admin goes looking for a particular person. */}
          {!selfOnlyPersonId && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-brand-900">{r.crew}</span>
              <select
                value={pickedPersonId}
                onChange={e => { setPickedPersonId(e.target.value); setOpenPersonId(null) }}
                className={FIELD}
              >
                <option value="">{r.allCrew}</option>
                {roster.map(p => (
                  <option key={p.id} value={p.id}>{p.nickname || p.name || p.id}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {loading && <p className="text-sm text-brand-900/70">{r.loading}</p>}
        {error && <p className={ERROR_NOTE_LIGHT}>{r.failed(error)}</p>}

        {!loading && !error && report && (
          selfOnlyPersonId ? (
            self
              ? <PersonBreakdown person={self} />
              : <p className="text-sm text-brand-900/70">{r.emptySelf}</p>
          ) : pickedPersonId ? (
            picked
              ? <PersonBreakdown person={picked} />
              : <p className="text-sm text-brand-900/70">{r.emptyPerson}</p>
          ) : !people.length ? (
            <p className="text-sm text-brand-900/70">{r.empty}</p>
          ) : (
            <table className="w-full table-fixed text-sm text-brand-900">
              <colgroup>
                <col />
                <col className="w-[3.6rem]" />
                <col className="w-[3.6rem]" />
                <col className="w-[6.5rem]" />
              </colgroup>
              <thead>
                <tr className="text-left text-xs text-brand-900/60">
                  <th className="py-1 pr-3 font-medium">{r.colPerson}</th>
                  <th className="py-1 pr-3 font-medium text-right">{r.colEvents}</th>
                  <th className="py-1 pr-3 font-medium text-right">{r.colStudents}</th>
                  <th className="py-1 font-medium text-right">{r.colCollected}</th>
                </tr>
              </thead>
              <tbody>
                {people.map(p => {
                  const open = openPersonId === p.personId
                  return (
                    <Fragment key={p.personId}>
                      <tr className="border-t border-surface-200">
                        <td className="py-1 pr-3">
                          <button type="button"
                            onClick={() => setOpenPersonId(id => id === p.personId ? null : p.personId)}
                            aria-expanded={open}
                            className="block w-full text-left truncate font-medium underline decoration-dotted hover:no-underline">
                            {p.name}
                          </button>
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums">{p.completed.events}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{p.completed.students}</td>
                        <td className="py-1 text-right tabular-nums font-semibold">{money(p.completed.collected)}</td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={4} className="pt-2 pb-4"><PersonBreakdown person={p} /></td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )
        )}

        <p className="text-[11px] text-brand-900/70">{r.rule}</p>
      </div>

      {!loading && !error && report && !selfOnlyPersonId && <UnattributedBlock report={report} />}
    </div>
  )
}
