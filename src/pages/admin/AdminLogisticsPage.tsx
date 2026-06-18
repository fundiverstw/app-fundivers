import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchEventsInRange, formatEventSpan } from '../../lib/events'
import { gearTotals, splitByTransport, dayKeyOffset } from '../../lib/logistics'
import { DiverGearCard, type DiverGearRow } from '../../components/admin/DiverGearCard'
import { TransportGroup } from '../../components/admin/TransportGroup'
import type { AppEvent, Booking, Profile } from '../../types/database'

interface EventGroup {
  event: AppEvent
  rows: DiverGearRow[]
}

const DAY_TABS: Array<{ offset: number; label: string }> = [
  { offset: 0, label: 'Today' },
  { offset: 1, label: 'Tomorrow' },
  { offset: 2, label: '2 days later' },
]

export function AdminLogisticsPage() {
  const [offset, setOffset] = useState(0)
  // null = loading; [] = loaded, no events that day.
  const [groups, setGroups] = useState<EventGroup[] | null>(null)

  const todayKey = useMemo(
    () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
    [],
  )
  const dayKey = dayKeyOffset(todayKey, offset)

  useEffect(() => {
    let cancelled = false
    // Reset to the loading spinner whenever the selected day changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGroups(null)
    ;(async () => {
      // fetchEventsInRange(day, day) returns dives starting that day and
      // courses running that day. A rare multi-day dive that started earlier
      // won't appear — acceptable for a day-of view.
      const events = await fetchEventsInRange(dayKey, dayKey, { includePrivate: true })
      if (cancelled) return
      // Dedupe by id (a course could yield more than one segment); first wins.
      const seen = new Set<string>()
      const uniqueEvents = events.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
      if (!uniqueEvents.length) { setGroups([]); return }

      const diveIds = uniqueEvents.filter(e => e.type === 'dive').map(e => e.id)
      const courseIds = uniqueEvents.filter(e => e.type === 'course').map(e => e.id)
      const [divesB, coursesB] = await Promise.all([
        diveIds.length
          ? supabase.from('bookings').select('*').in('eo_dive_id', diveIds).neq('status', 'cancelled')
          : Promise.resolve({ data: [] as Booking[] }),
        courseIds.length
          ? supabase.from('bookings').select('*').in('eo_course_id', courseIds).neq('status', 'cancelled')
          : Promise.resolve({ data: [] as Booking[] }),
      ])
      const bookings = [...(divesB.data ?? []), ...(coursesB.data ?? [])] as Booking[]

      const userIds = [...new Set(bookings.map(b => b.user_id))]
      const profsRes = userIds.length
        ? await supabase.from('profiles').select('*').in('id', userIds)
        : { data: [] as Profile[] }
      const profMap = new Map((profsRes.data ?? []).map(p => [p.id, p]))

      const byEvent = new Map<string, DiverGearRow[]>()
      for (const b of bookings) {
        const eid = b.eo_dive_id ?? b.eo_course_id
        if (!eid) continue
        const arr = byEvent.get(eid) ?? []
        arr.push({ booking: b, profile: profMap.get(b.user_id) ?? null })
        byEvent.set(eid, arr)
      }

      if (cancelled) return
      setGroups(uniqueEvents.map(ev => ({ event: ev, rows: byEvent.get(ev.id) ?? [] })))
    })()
    return () => { cancelled = true }
  }, [dayKey])

  // Keep a diver's displayed sizes in sync after an inline save, across every
  // event group they appear in that day.
  function patchProfile(diverId: string, patch: Partial<Profile>) {
    setGroups(prev => prev?.map(g => ({
      ...g,
      rows: g.rows.map(r =>
        r.profile && r.profile.id === diverId
          ? { ...r, profile: { ...r.profile, ...patch } as Profile }
          : r),
    })) ?? prev)
  }

  const allRows = (groups ?? []).flatMap(g => g.rows)
  const overallGear = gearTotals(allRows)
  const transport = splitByTransport(allRows)

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <header className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-bold text-blue-900">Logistics</h1>
          <span className="text-xs text-blue-900 font-medium">{dayKey}</span>
        </div>
        <div role="tablist" aria-label="Day" className="flex flex-wrap gap-2">
          {DAY_TABS.map(t => (
            <button
              key={t.offset}
              type="button"
              role="tab"
              aria-selected={offset === t.offset}
              onClick={() => setOffset(t.offset)}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${
                offset === t.offset
                  ? 'bg-blue-900 text-white font-semibold'
                  : 'bg-sky-100 text-blue-900 hover:bg-sky-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {groups === null ? (
        <div className="flex justify-center pt-12"><div className="w-6 h-6 border-2 border-blue-900 border-t-transparent rounded-full animate-spin" /></div>
      ) : groups.length === 0 ? (
        <p className="text-blue-950 font-medium text-sm">No events scheduled for {dayKey}.</p>
      ) : (
        <>
          <section className="bg-white/70 backdrop-blur-md border border-sky-200 rounded-xl p-4 space-y-3">
            <h2 className="text-sm font-bold text-blue-900 uppercase tracking-wider">Overall — {dayKey}</h2>
            <p className="text-sm text-blue-900 font-medium">
              {groups.length} event{groups.length === 1 ? '' : 's'} · {allRows.length} diver{allRows.length === 1 ? '' : 's'}
            </p>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Transportation</p>
              <p className="text-sm text-blue-900 font-medium">
                <span className="text-red-600 font-semibold">{transport.needsRide.length}</span> need a ride ·{' '}
                {transport.selfTransport.length} self-transport
                {transport.unspecified.length > 0 && <> · {transport.unspecified.length} unspecified</>}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Gear to pack</p>
              {overallGear.length === 0 ? (
                <p className="text-sm text-blue-950/70 font-medium italic">Nothing to pack — everyone's on own gear.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {overallGear.map(({ item, count }) => (
                    <span key={item} className="text-xs px-2 py-0.5 rounded-full border border-blue-900 text-blue-900">
                      {item} ×{count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          {groups.map(g => (
            <section key={g.event.id} className="space-y-2 pt-2">
              {/* Bold banner per event so the sections are obvious when
                  scrolling a tall phone screen. */}
              <div className="bg-blue-900 text-white rounded-xl px-4 py-2.5 space-y-0.5">
                <h2 className="text-base font-semibold break-words">{g.event.title}</h2>
                <span className="block text-xs text-white/80">
                  {formatEventSpan(g.event, { style: 'compact' })} · {g.rows.length} diver{g.rows.length === 1 ? '' : 's'}
                </span>
              </div>
              {g.rows.length === 0 ? (
                <p className="text-xs text-blue-950/70 font-medium italic pl-1">No active registrants.</p>
              ) : (
                <>
                  <EventTransport rows={g.rows} />
                  {g.rows.map(r => (
                    <DiverGearCard key={r.booking.id} row={r} onProfilePatched={patchProfile} />
                  ))}
                </>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function EventTransport({ rows }: { rows: DiverGearRow[] }) {
  const { needsRide, unspecified } = splitByTransport(rows)
  // Self-transport divers need no van planning, so only surface the actionable
  // buckets here (the full split lives on the event's Transportation tab).
  if (needsRide.length === 0 && unspecified.length === 0) return null
  return (
    <>
      {needsRide.length > 0 && (
        <TransportGroup title="Needs ride" rows={needsRide} emptyHint="" />
      )}
      {unspecified.length > 0 && (
        <TransportGroup
          title="Transport not specified"
          rows={unspecified}
          emptyHint=""
          note="Legacy bookings from before transport was a required question."
        />
      )}
    </>
  )
}
